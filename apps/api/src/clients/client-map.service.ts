import { Injectable } from '@nestjs/common';
import {
  boundingBox,
  type ClientMapDto,
  type ClientMapPointDto,
  type ClientMapQuery,
  type ClientNearbyPointDto,
  type ClientNearbyQuery,
  MAP_POINTS_MAX,
  toMoneyString,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { type DataScope, ScopeService } from '../sales-force/scope.service';

/** The cap of `/clients/map`; integration tests lower it to see `truncated` flip. */
export const mapLimits = { pointsMax: MAP_POINTS_MAX };

const EARTH_RADIUS_M = 6_371_008.8;

type Filters = Pick<
  ClientMapQuery,
  'search' | 'sectorId' | 'assignedSellerId' | 'hasDebt' | 'overLimit' | 'includeInactive'
>;

interface PointRow {
  id: string;
  code: string;
  name: string;
  commune: string | null;
  phone: string | null;
  lat: Prisma.Decimal;
  lng: Prisma.Decimal;
  active: boolean;
  balance: Prisma.Decimal;
  overLimit: boolean;
  sectorId: string | null;
  assignedSellerId: string | null;
}

function toPoint(r: PointRow): ClientMapPointDto {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    commune: r.commune,
    phone: r.phone,
    lat: r.lat.toNumber(),
    lng: r.lng.toNumber(),
    active: r.active,
    balance: toMoneyString(r.balance.toString()),
    overLimit: r.overLimit,
    sectorId: r.sectorId,
    assignedSellerId: r.assignedSellerId,
  };
}

const POINT_COLUMNS = Prisma.sql`
  c.id, c.code, c.name, c.commune, c.phone, c.lat, c.lng, c.active,
  COALESCE(b.balance, 0) AS balance,
  (c."creditLimit" IS NOT NULL AND COALESCE(b.balance, 0) > c."creditLimit") AS "overLimit",
  c."sectorId", c."assignedSellerId"`;

/**
 * The client map and "Clients proches" (phase 35). Read only, within the phase 14 scope,
 * on Client.lat/lng (phase 17). Straight-line distances, no PostGIS: a lat/lng box
 * prefilter on the partial index, then haversine in SQL.
 *
 * The boxes compare `lat_f` / `lng_f` (the same coordinates as float8, generated columns)
 * with float8 values, never `lat` / `lng` with numeric ones: the API's role is bound by
 * row-level security, under which only leakproof operators can be index conditions, and
 * numeric comparisons are not leakproof. With numeric the index was never used.
 */
@Injectable()
export class ClientMapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  async map(query: ClientMapQuery, user: CurrentUserInfo): Promise<ClientMapDto> {
    const scope = await this.scope.of(user);
    const where = this.filters(query, scope);
    const box =
      query.minLat !== undefined &&
      query.minLng !== undefined &&
      query.maxLat !== undefined &&
      query.maxLng !== undefined
        ? Prisma.sql`AND c.lat_f BETWEEN ${query.minLat}::float8 AND ${query.maxLat}::float8
            AND c.lng_f BETWEEN ${query.minLng}::float8 AND ${query.maxLng}::float8`
        : Prisma.empty;
    const cap = mapLimits.pointsMax;
    const [rows, without] = await Promise.all([
      this.prisma.db.$queryRaw<PointRow[]>`
        SELECT ${POINT_COLUMNS}
        FROM clients c LEFT JOIN client_balances b ON b."clientId" = c.id
        WHERE ${where} AND c.lat IS NOT NULL AND c.lng IS NOT NULL ${box}
        ORDER BY c.name, c.id
        LIMIT ${cap + 1}`,
      this.prisma.db.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n
        FROM clients c LEFT JOIN client_balances b ON b."clientId" = c.id
        WHERE ${where} AND (c.lat IS NULL OR c.lng IS NULL)`,
    ]);
    return {
      points: rows.slice(0, cap).map(toPoint),
      truncated: rows.length > cap,
      withoutLocation: Number(without[0]?.n ?? 0),
    };
  }

  async nearby(query: ClientNearbyQuery, user: CurrentUserInfo): Promise<ClientNearbyPointDto[]> {
    const scope = await this.scope.of(user);
    const where = this.filters(query, scope);
    const box = boundingBox(query, query.radiusM);
    const lngIn =
      box.minLng <= box.maxLng
        ? Prisma.sql`c.lng_f BETWEEN ${box.minLng}::float8 AND ${box.maxLng}::float8`
        : Prisma.sql`(c.lng_f >= ${box.minLng}::float8 OR c.lng_f <= ${box.maxLng}::float8)`;
    const lat = query.lat;
    const lng = query.lng;
    const rows = await this.prisma.db.$queryRaw<(PointRow & { distanceM: number })[]>`
      SELECT * FROM (
        SELECT ${POINT_COLUMNS},
          (2 * ${EARTH_RADIUS_M}::float8 * asin(least(1, sqrt(
            power(sin(radians(c.lat::float8 - ${lat}::float8) / 2), 2)
            + cos(radians(${lat}::float8)) * cos(radians(c.lat::float8))
              * power(sin(radians(c.lng::float8 - ${lng}::float8) / 2), 2)
          )))) AS "distanceM"
        FROM clients c LEFT JOIN client_balances b ON b."clientId" = c.id
        WHERE ${where} AND c.lat IS NOT NULL AND c.lng IS NOT NULL
          AND c.lat_f BETWEEN ${box.minLat}::float8 AND ${box.maxLat}::float8 AND ${lngIn}
      ) near
      WHERE near."distanceM" <= ${query.radiusM}
      ORDER BY near."distanceM", near.name, near.id
      LIMIT ${query.limit}`;
    return rows.map((r) => ({ ...toPoint(r), distanceM: Math.round(r.distanceM) }));
  }

  /** The client-list filters (ClientsService.list), the scope, live clients only. */
  private filters(q: Filters, scope: DataScope): Prisma.Sql {
    const tenantId = tenantContext.requireTenantId();
    const f: Prisma.Sql[] = [
      Prisma.sql`c."tenantId" = ${tenantId}::uuid`,
      Prisma.sql`c."deletedAt" IS NULL`,
      this.scope.clientSql(scope, 'c'),
    ];
    if (!q.includeInactive) f.push(Prisma.sql`c.active`);
    if (q.sectorId) f.push(Prisma.sql`c."sectorId" = ${q.sectorId}::uuid`);
    if (q.assignedSellerId) f.push(Prisma.sql`c."assignedSellerId" = ${q.assignedSellerId}::uuid`);
    const search = q.search?.trim();
    if (search) {
      const like = `%${search.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
      f.push(
        Prisma.sql`(c.code ILIKE ${like} OR c.name ILIKE ${like} OR c.phone ILIKE ${like} OR c.phone2 ILIKE ${like})`,
      );
    }
    if (q.hasDebt) f.push(Prisma.sql`COALESCE(b.balance, 0) > 0`);
    if (q.overLimit)
      f.push(Prisma.sql`c."creditLimit" IS NOT NULL AND COALESCE(b.balance, 0) > c."creditLimit"`);
    return Prisma.join(f, ' AND ');
  }
}
