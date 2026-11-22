import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  type AdjustSellerSessionInput,
  algiersDay,
  algiersDayBounds,
  type CloseSellerSessionInput,
  ErrorCode,
  type ExpectedCashDto,
  type MeDayDto,
  money,
  type OpenSellerSessionInput,
  PaymentMode,
  Role,
  type SellerDayDto,
  type SellerSessionCloseResultDto,
  type SellerSessionDto,
  SellerSessionStatus,
  toMoneyString,
  toQtyString,
  type VehicleStockLineDto,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import { type CurrentUserInfo } from '../auth/auth.types';
import { ClockService } from '../clock/clock.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { fromIsoDate, toIsoDate } from '../sales/sale.mapper';
import { ScopeService } from '../sales-force/scope.service';
import { StockTransfersService } from '../stock/stock-transfers.service';
import { VehiclesService } from '../stock/vehicles.service';
import { WarehousesService } from '../stock/warehouses.service';
import { assertVisible, tourneeSellerIds } from './tournee-scope';

type Db = PrismaService['db'] | Tx;

const sessionInclude = {
  seller: { select: { id: true, fullName: true } },
  warehouse: { select: { id: true, name: true } },
  adjustments: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.SellerSessionInclude;

type SessionRow = Prisma.SellerSessionGetPayload<{ include: typeof sessionInclude }>;

const ZERO: ExpectedCashDto = { fromSales: '0.00', fromVersements: '0.00', total: '0.00' };

/** Users who end a day with cash or goods to hand over. */
const ROAD_ROLES = [Role.SELLER, Role.LIVREUR];

/**
 * Clôture de tournée (phase 16). The API computes the cash a seller must hand over; the
 * manager types what he handed; the écart is stored and audited. Closing is final: a
 * correction is an ADJUST row pointing to the closed session, never an update.
 *
 * Expected cash = cash (ESPECES) payments still VALID, collected by the seller
 * (`collectedBy`), received within the Algiers day: the cash part of the sales he made
 * or delivered, and the versements he collected.
 */
@Injectable()
export class SellerSessionsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly warehouses: WarehousesService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    private readonly vehicles: VehiclesService,
    private readonly transfers: StockTransfersService,
  ) {}

  /**
   * Money responsibility stays clear (phase 36): a driver does not leave a truck with cash
   * nobody counted. The stock module owns driver changes and asks us through this guard.
   * It looks at the driver's cash, not at one session row (test-36 A-4):
   * - any day of his still open refuses the change, whatever truck the session names (a
   *   day opened before he had a truck names none);
   * - his last clôture being closed, the cash he collected on that day after its last
   *   count (the closing, or its latest adjustment) refuses it too: there is one clôture
   *   per seller per day, so what he collects after it, on a second truck or not, is in no
   *   count until the clôture is adjusted.
   */
  onModuleInit(): void {
    this.vehicles.registerDriverChangeGuard(async (tx, leaving) => {
      const open = await tx.sellerSession.findFirst({
        where: {
          sellerId: leaving.userId,
          status: SellerSessionStatus.OPEN,
          adjustsSessionId: null,
        },
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        select: { id: true, date: true },
      });
      if (open) {
        throw new AppException(
          ErrorCode.SESSION_OPEN_ON_VEHICLE,
          "The driver's day is open: close it first",
          { sessionId: open.id, date: toIsoDate(open.date), ...leaving },
        );
      }
      const last = await tx.sellerSession.findFirst({
        where: {
          sellerId: leaving.userId,
          status: SellerSessionStatus.CLOSED,
          adjustsSessionId: null,
        },
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          date: true,
          closedAt: true,
          adjustments: { select: { closedAt: true, createdAt: true } },
        },
      });
      if (!last?.closedAt) return;
      const countedAt = [last.closedAt, ...last.adjustments.map((a) => a.closedAt ?? a.createdAt)]
        .sort((a, b) => a.getTime() - b.getTime())
        .at(-1)!;
      const day = toIsoDate(last.date);
      const { start, end } = algiersDayBounds(day);
      const rows = await tx.$queryRaw<{ total: Prisma.Decimal }[]>`
        SELECT COALESCE(SUM(p.amount), 0) AS total FROM payments p
        WHERE p."tenantId" = ${tenantContext.requireTenantId()}::uuid
          AND p."collectedBy" = ${leaving.userId}::uuid
          AND p.mode = ${PaymentMode.ESPECES}::"PaymentMode"
          AND p.status = 'VALID'
          AND p."receivedAt" >= ${start} AND p."receivedAt" < ${end}
          AND p."createdAt" > ${countedAt}`;
      const uncounted = money(rows[0]?.total.toString() ?? '0');
      if (uncounted.gt(0)) {
        throw new AppException(
          ErrorCode.CASH_AFTER_CLOSING,
          'The driver collected cash after his last clôture: count it first',
          { sessionId: last.id, date: day, amount: toMoneyString(uncounted), ...leaving },
        );
      }
    });
  }

  /** The clôture screen: every road user of the day, with a session or not. */
  async listDay(date: string | undefined, user: CurrentUserInfo): Promise<SellerDayDto[]> {
    const day = date ?? algiersDay(this.clock.now());
    const ids = await tourneeSellerIds(this.scope, user);
    const { start, end } = algiersDayBounds(day);
    const tenantId = tenantContext.requireTenantId();
    const active = await this.prisma.db.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT p."collectedBy" AS id FROM payments p
      WHERE p."tenantId" = ${tenantId}::uuid AND p."collectedBy" IS NOT NULL
        AND p."receivedAt" >= ${start} AND p."receivedAt" < ${end}
      UNION
      SELECT s."sellerId" FROM seller_sessions s
      WHERE s."tenantId" = ${tenantId}::uuid AND s.date = ${fromIsoDate(day)}::date`;
    const users = await this.prisma.db.user.findMany({
      where: {
        AND: [
          ids ? { id: { in: ids } } : {},
          {
            OR: [
              { role: { in: ROAD_ROLES }, deletedAt: null },
              { id: { in: active.map((a) => a.id) } },
            ],
          },
        ],
      },
      select: { id: true, fullName: true },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
    });
    const userIds = users.map((u) => u.id);
    const [expected, sessions, vehicles] = await Promise.all([
      this.expectedMany(this.prisma.db, userIds, day),
      this.prisma.db.sellerSession.findMany({
        where: { sellerId: { in: userIds }, date: fromIsoDate(day), adjustsSessionId: null },
        include: sessionInclude,
      }),
      this.vehicles.currentVehiclesOf(userIds),
    ]);
    const sessionOf = new Map(sessions.map((s) => [s.sellerId, s]));
    const live = await this.liveFor(sessions);
    const names = await this.names(sessions);
    return users.map((u) => {
      const s = sessionOf.get(u.id);
      return {
        seller: u,
        date: day,
        session: s ? this.toDto(s, live, names) : null,
        expected: expected.get(u.id) ?? ZERO,
        vehicle: this.vehicleRef(vehicles.get(u.id)),
      };
    });
  }

  /**
   * The caller's own day (phase 39, A2): his truck, his session, his expected cash, what
   * is on the truck and today's validated chargements / déchargements. Only his: no
   * other user is ever read, so no scope check is needed beyond the role guard.
   */
  async myDay(user: CurrentUserInfo): Promise<MeDayDto> {
    const day = algiersDay(this.clock.now());
    const [vehicle, sessionId] = await Promise.all([
      this.vehicles.currentVehicleOf(user.id),
      this.find(user.id, day),
    ]);
    const session = sessionId
      ? await this.prisma.db.sellerSession.findUniqueOrThrow({
          where: { id: sessionId },
          include: sessionInclude,
        })
      : null;
    const sessionDto = session
      ? this.toDto(session, await this.liveFor([session]), await this.names([session]))
      : null;
    // A closed day keeps the figures frozen at the clôture; otherwise the live rule.
    const expected =
      sessionDto && session!.status !== SellerSessionStatus.OPEN
        ? sessionDto.expected
        : ((await this.expectedMany(this.prisma.db, [user.id], day)).get(user.id) ?? ZERO);
    const [stock, transfers] = vehicle
      ? await Promise.all([
          this.vehicleStock(vehicle.id),
          this.transfers.validatedForVehicle(vehicle.id, day),
        ])
      : [[], []];
    return {
      day,
      vehicle: vehicle
        ? { id: vehicle.id, code: vehicle.code, name: vehicle.name, wilayaCode: vehicle.wilayaCode }
        : null,
      session: sessionDto,
      expected,
      stock,
      transfers,
    };
  }

  private vehicleRef(v: { id: string; name: string } | undefined) {
    return v ? { id: v.id, name: v.name } : null;
  }

  async get(id: string, user: CurrentUserInfo): Promise<SellerSessionDto> {
    const s = await this.prisma.db.sellerSession.findFirst({
      where: { id, adjustsSessionId: null },
      include: sessionInclude,
    });
    if (!s) throw new AppException(ErrorCode.NOT_FOUND, 'Session not found');
    assertVisible(await tourneeSellerIds(this.scope, user), [s.sellerId], ErrorCode.NOT_FOUND);
    return this.toDto(s, await this.liveFor([s]), await this.names([s]));
  }

  /** Opens the seller's day, or returns the one already there (safe to repeat). */
  async open(input: OpenSellerSessionInput, user: CurrentUserInfo): Promise<SellerSessionDto> {
    const day = input.date ?? algiersDay(this.clock.now());
    assertVisible(await tourneeSellerIds(this.scope, user), [input.sellerId], ErrorCode.NOT_FOUND);
    const seller = await this.prisma.db.user.findFirst({
      where: { id: input.sellerId },
      select: { id: true },
    });
    if (!seller) throw new AppException(ErrorCode.NOT_FOUND, 'Seller not found');
    const existing = await this.find(input.sellerId, day);
    if (existing) return this.get(existing, user);
    try {
      const id = await this.prisma.db.$transaction(async (tx) => {
        const s = await tx.sellerSession.create({
          data: {
            tenantId: tenantContext.requireTenantId(),
            sellerId: input.sellerId,
            date: fromIsoDate(day),
            warehouseId: await this.warehouses.vehicleOf(tx, input.sellerId),
            createdBy: user.id,
          },
        });
        await this.audit.log(tx, {
          action: 'SELLER_SESSION_OPENED',
          entity: 'SellerSession',
          entityId: s.id,
          after: { sellerId: input.sellerId, date: day },
        });
        return s.id;
      });
      return this.get(id, user);
    } catch (e) {
      // Opened at the same moment by someone else (one per seller per day).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const id = await this.find(input.sellerId, day);
        if (id) return this.get(id, user);
      }
      throw e;
    }
  }

  async close(
    id: string,
    input: CloseSellerSessionInput,
    user: CurrentUserInfo,
  ): Promise<SellerSessionCloseResultDto> {
    const warehouseId = await this.prisma.db.$transaction(async (tx) => {
      const s = await this.lock(tx, id, user);
      if (s.status !== SellerSessionStatus.OPEN) {
        throw new AppException(ErrorCode.SESSION_ALREADY_CLOSED, 'Already closed', {
          closedAt: s.closedAt?.toISOString() ?? null,
        });
      }
      const day = toIsoDate(s.date);
      const expected = (await this.expectedMany(tx, [s.sellerId], day)).get(s.sellerId) ?? ZERO;
      const ecart = money(input.handedCash).minus(expected.total);
      await tx.sellerSession.update({
        where: { id },
        data: {
          status: SellerSessionStatus.CLOSED,
          expectedCash: expected.total,
          cashFromSales: expected.fromSales,
          cashFromPayments: expected.fromVersements,
          handedCash: input.handedCash,
          ecart: ecart.toString(),
          note: input.note,
          closedBy: user.id,
          closedAt: new Date(),
        },
      });
      await this.audit.log(tx, {
        action: 'SELLER_SESSION_CLOSED',
        entity: 'SellerSession',
        entityId: id,
        after: {
          sellerId: s.sellerId,
          date: day,
          expected,
          handedCash: input.handedCash,
          ecart: ecart.toString(),
        },
      });
      return s.warehouseId;
    });
    return {
      session: await this.get(id, user),
      vehicleStock: warehouseId ? await this.vehicleStock(warehouseId) : [],
    };
  }

  /** A note (and a new count) on a closed session, as a new row. */
  async adjust(
    id: string,
    input: AdjustSellerSessionInput,
    user: CurrentUserInfo,
  ): Promise<SellerSessionDto> {
    await this.prisma.db.$transaction(async (tx) => {
      const s = await this.lock(tx, id, user);
      if (s.status !== SellerSessionStatus.CLOSED) {
        throw new AppException(ErrorCode.SESSION_NOT_CLOSED, 'Only a closed session', {
          status: s.status,
        });
      }
      const ecart =
        input.handedCash !== null && s.expectedCash !== null
          ? money(input.handedCash).minus(s.expectedCash.toString()).toString()
          : null;
      const row = await tx.sellerSession.create({
        data: {
          tenantId: tenantContext.requireTenantId(),
          sellerId: s.sellerId,
          date: s.date,
          warehouseId: s.warehouseId,
          status: SellerSessionStatus.ADJUST,
          expectedCash: s.expectedCash,
          handedCash: input.handedCash,
          ecart,
          note: input.note,
          adjustsSessionId: id,
          createdBy: user.id,
          closedBy: user.id,
          closedAt: new Date(),
        },
      });
      await this.audit.log(tx, {
        action: 'SELLER_SESSION_ADJUSTED',
        entity: 'SellerSession',
        entityId: id,
        after: { adjustmentId: row.id, handedCash: input.handedCash, ecart, note: input.note },
      });
    });
    return this.get(id, user);
  }

  /** Expected cash per collector for an Algiers day. */
  async expectedMany(
    db: Db,
    userIds: string[],
    day: string,
  ): Promise<Map<string, ExpectedCashDto>> {
    if (userIds.length === 0) return new Map();
    const { start, end } = algiersDayBounds(day);
    const rows = await db.$queryRaw<
      { id: string; fromSales: Prisma.Decimal; fromVersements: Prisma.Decimal }[]
    >`
      SELECT p."collectedBy" AS id,
        COALESCE(SUM(p.amount) FILTER (WHERE p."saleId" IS NOT NULL), 0) AS "fromSales",
        COALESCE(SUM(p.amount) FILTER (WHERE p."saleId" IS NULL), 0) AS "fromVersements"
      FROM payments p
      WHERE p."tenantId" = ${tenantContext.requireTenantId()}::uuid
        AND p."collectedBy" = ANY(${userIds}::uuid[])
        AND p.mode = ${PaymentMode.ESPECES}::"PaymentMode"
        AND p.status = 'VALID'
        AND p."receivedAt" >= ${start} AND p."receivedAt" < ${end}
      GROUP BY p."collectedBy"`;
    return new Map(
      rows.map((r) => {
        const sales = money(r.fromSales.toString());
        const versements = money(r.fromVersements.toString());
        return [
          r.id,
          {
            fromSales: toMoneyString(sales),
            fromVersements: toMoneyString(versements),
            total: toMoneyString(sales.plus(versements)),
          },
        ];
      }),
    );
  }

  private async find(sellerId: string, day: string): Promise<string | null> {
    const s = await this.prisma.db.sellerSession.findFirst({
      where: { sellerId, date: fromIsoDate(day), adjustsSessionId: null },
      select: { id: true },
    });
    return s?.id ?? null;
  }

  private async lock(tx: Tx, id: string, user: CurrentUserInfo) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM seller_sessions
      WHERE id = ${id}::uuid AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
        AND "adjustsSessionId" IS NULL
      FOR UPDATE`;
    if (!rows[0]) throw new AppException(ErrorCode.NOT_FOUND, 'Session not found');
    const s = await tx.sellerSession.findUniqueOrThrow({ where: { id } });
    assertVisible(await tourneeSellerIds(this.scope, user, tx), [s.sellerId], ErrorCode.NOT_FOUND);
    return s;
  }

  /** Live expected cash of the sessions still open. */
  private async liveFor(sessions: SessionRow[]): Promise<Map<string, ExpectedCashDto>> {
    const open = sessions.filter((s) => s.status === SellerSessionStatus.OPEN);
    const out = new Map<string, ExpectedCashDto>();
    for (const s of open) {
      const e = await this.expectedMany(this.prisma.db, [s.sellerId], toIsoDate(s.date));
      out.set(s.id, e.get(s.sellerId) ?? ZERO);
    }
    return out;
  }

  private async vehicleStock(warehouseId: string): Promise<VehicleStockLineDto[]> {
    const rows = await this.prisma.db.warehouseStock.findMany({
      where: { warehouseId, NOT: { qtyBase: 0 } },
      include: {
        product: {
          select: {
            reference: true,
            designation: true,
            baseUnitId: true,
            baseUnit: { select: { code: true } },
          },
        },
      },
      orderBy: { product: { designation: 'asc' } },
    });
    return rows.map((r) => ({
      productId: r.productId,
      reference: r.product.reference,
      designation: r.product.designation,
      unitId: r.product.baseUnitId,
      unitCode: r.product.baseUnit.code,
      qtyBase: toQtyString(r.qtyBase.toString()),
    }));
  }

  /** Who closed and who adjusted (plain user ids on the rows). */
  private async names(
    sessions: SessionRow[],
  ): Promise<Map<string, { id: string; fullName: string }>> {
    const ids = new Set<string>();
    for (const s of sessions) {
      if (s.closedBy) ids.add(s.closedBy);
      for (const a of s.adjustments) if (a.closedBy) ids.add(a.closedBy);
    }
    if (ids.size === 0) return new Map();
    const users = await this.prisma.db.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, fullName: true },
    });
    return new Map(users.map((u) => [u.id, u]));
  }

  private toDto(
    s: SessionRow,
    live: Map<string, ExpectedCashDto>,
    names: Map<string, { id: string; fullName: string }>,
  ): SellerSessionDto {
    const m = (d: Prisma.Decimal | null) => (d === null ? null : toMoneyString(d.toString()));
    const expected: ExpectedCashDto =
      s.status === SellerSessionStatus.OPEN
        ? (live.get(s.id) ?? ZERO)
        : {
            fromSales: m(s.cashFromSales) ?? '0.00',
            fromVersements: m(s.cashFromPayments) ?? '0.00',
            total: m(s.expectedCash) ?? '0.00',
          };
    return {
      id: s.id,
      seller: s.seller,
      date: toIsoDate(s.date),
      status: s.status,
      warehouse: s.warehouse,
      expected,
      handedCash: m(s.handedCash),
      ecart: m(s.ecart),
      note: s.note,
      closedBy: s.closedBy ? (names.get(s.closedBy) ?? null) : null,
      closedAt: s.closedAt?.toISOString() ?? null,
      adjustments: s.adjustments.map((a) => ({
        id: a.id,
        handedCash: m(a.handedCash),
        ecart: m(a.ecart),
        note: a.note,
        by: a.closedBy ? (names.get(a.closedBy) ?? null) : null,
        at: (a.closedAt ?? a.createdAt).toISOString(),
      })),
    };
  }
}
