import { Injectable } from '@nestjs/common';
import {
  type ClientLocationDto,
  type ClientLocationInput,
  ErrorCode,
  GeoChangeRequestStatus,
  type LatLng,
  type LocationRequestDto,
  type LocationRequestInput,
  type LocationRequestListQuery,
  Role,
  isTeamLead,
  TEAM_LEAD_ROLES,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ScopeService } from '../sales-force/scope.service';

/** They move a client's point directly; a SELLER goes through a request (phase 17). */
const DIRECT_ROLES = new Set<string>([Role.OWNER, Role.MANAGER, ...TEAM_LEAD_ROLES]);
const DECIDER_ROLES = new Set<string>([Role.OWNER, Role.MANAGER]);

type ClientPoint = {
  lat: Prisma.Decimal | null;
  lng: Prisma.Decimal | null;
  geoAccuracyM: number | null;
};

const requestInclude = {
  client: { select: { id: true, code: true, name: true } },
} satisfies Prisma.ClientGeoChangeRequestInclude;
type RequestRow = Prisma.ClientGeoChangeRequestGetPayload<{ include: typeof requestInclude }>;

const pointOf = (c: ClientPoint): LatLng | null =>
  c.lat !== null && c.lng !== null ? { lat: c.lat.toNumber(), lng: c.lng.toNumber() } : null;

/**
 * The client's reference GPS point (phase 17, GEO_CHECK). Set once freely; after that a
 * seller's change is a request that a manager, or a supervisor of the seller, decides.
 * Every change is audited with the point before and after.
 */
@Injectable()
export class ClientLocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  /** The point GeoCheckService compares with; null when the client has none. */
  async pointInTx(tx: Tx, clientId: string): Promise<LatLng | null> {
    const c = await tx.client.findFirst({
      where: { id: clientId },
      select: { lat: true, lng: true, geoAccuracyM: true },
    });
    return c ? pointOf(c) : null;
  }

  async set(
    clientId: string,
    input: ClientLocationInput,
    user: CurrentUserInfo,
  ): Promise<ClientLocationDto> {
    return this.prisma.db.$transaction(async (tx) => {
      await this.scope.assertClient(tx, user, clientId);
      const current = await lockClient(tx, clientId);
      if (pointOf(current) && !DIRECT_ROLES.has(user.role)) {
        throw new AppException(
          ErrorCode.GEO_CHANGE_NEEDS_APPROVAL,
          'The client already has a location: ask for a change',
        );
      }
      return this.apply(tx, clientId, current, input, user.id, 'CLIENT_LOCATION_SET');
    });
  }

  async request(
    clientId: string,
    input: LocationRequestInput,
    user: CurrentUserInfo,
  ): Promise<LocationRequestDto> {
    const id = await this.prisma.db.$transaction(async (tx) => {
      await this.scope.assertClient(tx, user, clientId);
      const current = await lockClient(tx, clientId);
      const r = await tx.clientGeoChangeRequest.create({
        data: {
          tenantId: tenantContext.requireTenantId(),
          clientId,
          lat: input.lat,
          lng: input.lng,
          accuracyM: input.accuracyM === null ? null : Math.round(input.accuracyM),
          previousLat: current.lat,
          previousLng: current.lng,
          note: input.note || null,
          requestedBy: user.id,
        },
      });
      await this.audit.log(tx, {
        action: 'CLIENT_LOCATION_REQUESTED',
        entity: 'Client',
        entityId: clientId,
        before: pointOf(current),
        after: { requestId: r.id, lat: input.lat, lng: input.lng, accuracyM: input.accuracyM },
      });
      return r.id;
    });
    return this.getRequest(id, user);
  }

  async approve(id: string, user: CurrentUserInfo): Promise<LocationRequestDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const r = await this.lockPending(tx, id, user);
      const current = await lockClient(tx, r.clientId);
      await this.apply(
        tx,
        r.clientId,
        current,
        { lat: r.lat.toNumber(), lng: r.lng.toNumber(), accuracyM: r.accuracyM },
        r.requestedBy,
        'CLIENT_LOCATION_APPROVED',
        { requestId: id, approvedBy: user.id },
      );
      await tx.clientGeoChangeRequest.update({
        where: { id },
        data: {
          status: GeoChangeRequestStatus.APPROVED,
          decidedBy: user.id,
          decidedAt: new Date(),
        },
      });
    });
    return this.getRequest(id, user);
  }

  async reject(id: string, reason: string, user: CurrentUserInfo): Promise<LocationRequestDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const r = await this.lockPending(tx, id, user);
      await tx.clientGeoChangeRequest.update({
        where: { id },
        data: {
          status: GeoChangeRequestStatus.REJECTED,
          decidedBy: user.id,
          decidedAt: new Date(),
          rejectReason: reason,
        },
      });
      await this.audit.log(tx, {
        action: 'CLIENT_LOCATION_REJECTED',
        entity: 'Client',
        entityId: r.clientId,
        after: { requestId: id, reason },
      });
    });
    return this.getRequest(id, user);
  }

  /** Managers see every request, a supervisor his team's, a seller his own. */
  async listRequests(
    query: LocationRequestListQuery,
    user: CurrentUserInfo,
  ): Promise<LocationRequestDto[]> {
    const requesters = await this.visibleRequesters(user);
    const rows = await this.prisma.db.clientGeoChangeRequest.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.clientId ? { clientId: query.clientId } : {}),
        ...(requesters ? { requestedBy: { in: requesters } } : {}),
      },
      include: requestInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return this.toDtos(rows, user);
  }

  private async getRequest(id: string, user: CurrentUserInfo): Promise<LocationRequestDto> {
    const r = await this.prisma.db.clientGeoChangeRequest.findFirst({
      where: { id },
      include: requestInclude,
    });
    if (!r) throw new AppException(ErrorCode.NOT_FOUND, 'Request not found');
    const [dto] = await this.toDtos([r], user);
    return dto!;
  }

  private async apply(
    tx: Tx,
    clientId: string,
    before: ClientPoint,
    input: ClientLocationInput,
    setBy: string,
    action: string,
    extra: Record<string, unknown> = {},
  ): Promise<ClientLocationDto> {
    const setAt = new Date();
    const accuracyM = input.accuracyM === null ? null : Math.round(input.accuracyM);
    await tx.client.update({
      where: { id: clientId },
      data: {
        lat: input.lat,
        lng: input.lng,
        geoAccuracyM: accuracyM,
        geoSetAt: setAt,
        geoSetBy: setBy,
      },
    });
    await this.audit.log(tx, {
      action,
      entity: 'Client',
      entityId: clientId,
      before: pointOf(before) ? { ...pointOf(before), accuracyM: before.geoAccuracyM } : null,
      after: { lat: input.lat, lng: input.lng, accuracyM, setBy, ...extra },
    });
    return {
      lat: input.lat,
      lng: input.lng,
      accuracyM,
      setAt: setAt.toISOString(),
      setById: setBy,
    };
  }

  private async lockPending(tx: Tx, id: string, user: CurrentUserInfo) {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM client_geo_change_requests
      WHERE id = ${id}::uuid AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
      FOR UPDATE`;
    if (locked.length === 0) throw new AppException(ErrorCode.NOT_FOUND, 'Request not found');
    const r = await tx.clientGeoChangeRequest.findUniqueOrThrow({ where: { id } });
    if (!(await this.canDecide(user, r.requestedBy, tx))) {
      throw new AppException(ErrorCode.FORBIDDEN, 'You may not decide this request');
    }
    if (r.status !== GeoChangeRequestStatus.PENDING) {
      throw new AppException(ErrorCode.GEO_REQUEST_NOT_PENDING, 'Request already decided', {
        status: r.status,
      });
    }
    return r;
  }

  /** A manager, or a supervisor above the requester (never on his own request). */
  private async canDecide(user: CurrentUserInfo, requestedBy: string, db?: Tx): Promise<boolean> {
    if (DECIDER_ROLES.has(user.role)) return true;
    if (!isTeamLead(user.role) || requestedBy === user.id) return false;
    return (await this.scope.teamIds(user.id, db)).includes(requestedBy);
  }

  private async visibleRequesters(user: CurrentUserInfo): Promise<string[] | null> {
    if (DECIDER_ROLES.has(user.role)) return null;
    if (isTeamLead(user.role)) return this.scope.teamIds(user.id);
    return [user.id];
  }

  private async toDtos(rows: RequestRow[], user: CurrentUserInfo): Promise<LocationRequestDto[]> {
    const userIds = [
      ...new Set(rows.flatMap((r) => [r.requestedBy, r.decidedBy]).filter((x): x is string => !!x)),
    ];
    const users = await this.prisma.db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    const team = isTeamLead(user.role) ? new Set(await this.scope.teamIds(user.id)) : null;
    return rows.map((r) => ({
      id: r.id,
      client: r.client,
      lat: r.lat.toNumber(),
      lng: r.lng.toNumber(),
      accuracyM: r.accuracyM,
      previous:
        r.previousLat !== null && r.previousLng !== null
          ? { lat: r.previousLat.toNumber(), lng: r.previousLng.toNumber() }
          : null,
      note: r.note,
      status: r.status,
      requestedBy: byId.get(r.requestedBy) ?? null,
      requestedAt: r.createdAt.toISOString(),
      decidedBy: r.decidedBy ? (byId.get(r.decidedBy) ?? null) : null,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      rejectReason: r.rejectReason,
      canDecide:
        r.status === GeoChangeRequestStatus.PENDING &&
        (DECIDER_ROLES.has(user.role) ||
          (!!team && r.requestedBy !== user.id && team.has(r.requestedBy))),
    }));
  }
}

async function lockClient(tx: Tx, clientId: string): Promise<ClientPoint> {
  const rows = await tx.$queryRaw<ClientPoint[]>`
    SELECT lat, lng, "geoAccuracyM" FROM clients
    WHERE id = ${clientId}::uuid AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
      AND "deletedAt" IS NULL
    FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Client not found');
  return row;
}
