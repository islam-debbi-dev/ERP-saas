import { Injectable } from '@nestjs/common';
import { ErrorCode, Feature, Role, SELLING_ROLES, SellerScope } from '@erp/shared';
import { type CurrentUserInfo } from '../auth/auth.types';
import { FeaturesService } from '../billing/features.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';

/**
 * What a user may see (phase 14). null = no restriction.
 * - `clientSellerIds`: only clients assigned to one of these users.
 * - `documentUserIds`: only sales / versements made by one of these users.
 */
export interface DataScope {
  clientSellerIds: string[] | null;
  documentUserIds: string[] | null;
}

const UNRESTRICTED: DataScope = { clientSellerIds: null, documentUserIds: null };

type Db = PrismaService['db'] | Tx;

/**
 * The one place that decides which clients, sales and versements a user sees.
 * Every service applies it; the web only mirrors it. Outside the SALES_FORCE module
 * nobody is restricted (old behaviour, and a module turned off hides nothing).
 *
 * - OWNER / MANAGER (and STOREKEEPER, LIVREUR, limited by their routes): everything.
 * - SELLER: everything under ALL_CLIENTS; under ASSIGNED_ONLY, his assigned clients and
 *   his own sales and versements (the client comptoir has no client, so it stays open).
 * - SUPERVISOR: the documents of his team (himself and everyone under him); under
 *   ASSIGNED_ONLY, only the clients assigned to his team.
 */
@Injectable()
export class ScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly features: FeaturesService,
  ) {}

  async of(user: CurrentUserInfo, db: Db = this.prisma.db): Promise<DataScope> {
    if (user.role !== Role.SELLER && user.role !== Role.SUPERVISOR) return UNRESTRICTED;
    if (!(await this.salesForceOn(user.tenantId))) return UNRESTRICTED;
    const tenant = await db.tenant.findUniqueOrThrow({
      where: { id: user.tenantId },
      select: { sellerScope: true },
    });
    const assignedOnly = tenant.sellerScope === SellerScope.ASSIGNED_ONLY;
    if (user.role === Role.SELLER) {
      return assignedOnly
        ? { clientSellerIds: [user.id], documentUserIds: [user.id] }
        : UNRESTRICTED;
    }
    const team = await this.teamIds(user.id, db);
    return { clientSellerIds: assignedOnly ? team : null, documentUserIds: team };
  }

  /**
   * Whose sales a user's figures (reports, dashboard) cover, whatever the module: a seller
   * always his own (as before phase 14), a supervisor his team, the others everyone.
   * Narrowed by the `sellerId` / `teamOf` filters an office user picks; a filter outside
   * the user's own reach gives nobody ([]), never more.
   */
  async figuresSellerIds(
    user: CurrentUserInfo,
    filters: { sellerId?: string; teamOf?: string } = {},
  ): Promise<string[] | null> {
    let ids: string[] | null =
      user.role === Role.SELLER
        ? [user.id]
        : user.role === Role.SUPERVISOR
          ? await this.teamIds(user.id)
          : null;
    const narrow = (wanted: string[]) => {
      ids = ids === null ? wanted : ids.filter((id) => wanted.includes(id));
    };
    if (filters.teamOf) narrow(await this.teamIds(filters.teamOf));
    if (filters.sellerId) narrow([filters.sellerId]);
    return ids;
  }

  async salesForceOn(tenantId: string): Promise<boolean> {
    return (await this.features.of(tenantId)).features.includes(Feature.SALES_FORCE);
  }

  /** The user and everyone under him, any depth (live or not: history stays visible). */
  async teamIds(userId: string, db: Db = this.prisma.db): Promise<string[]> {
    const tenantId = tenantContext.requireTenantId();
    const rows = await db.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE team AS (
        SELECT id FROM users WHERE id = ${userId}::uuid AND "tenantId" = ${tenantId}::uuid
        UNION
        SELECT u.id FROM users u JOIN team t ON u."managerId" = t.id
        WHERE u."tenantId" = ${tenantId}::uuid
      )
      SELECT id FROM team`;
    return rows.map((r) => r.id);
  }

  clientWhere(scope: DataScope): Prisma.ClientWhereInput {
    return scope.clientSellerIds ? { assignedSellerId: { in: scope.clientSellerIds } } : {};
  }

  /** Legacy sales (no sellerId, before phase 14) belong to their creator. */
  saleWhere(scope: DataScope): Prisma.SaleWhereInput {
    const ids = scope.documentUserIds;
    if (!ids) return {};
    return { OR: [{ sellerId: { in: ids } }, { sellerId: null, createdBy: { in: ids } }] };
  }

  /** Legacy versements (no collectedBy) belong to whoever received them. */
  paymentWhere(scope: DataScope): Prisma.PaymentWhereInput {
    const ids = scope.documentUserIds;
    if (!ids) return {};
    return { OR: [{ collectedBy: { in: ids } }, { collectedBy: null, receivedBy: { in: ids } }] };
  }

  /** Same as `clientWhere` for raw SQL, on a clients alias. */
  clientSql(scope: DataScope, alias: string): Prisma.Sql {
    if (!scope.clientSellerIds) return Prisma.sql`TRUE`;
    return Prisma.sql`${Prisma.raw(`${alias}."assignedSellerId"`)} = ANY(${scope.clientSellerIds}::uuid[])`;
  }

  /** Same as `saleWhere` for raw SQL, on a sales alias. */
  saleSql(scope: DataScope, alias: string): Prisma.Sql {
    if (!scope.documentUserIds) return Prisma.sql`TRUE`;
    return Prisma.sql`COALESCE(${Prisma.raw(`${alias}."sellerId"`)}, ${Prisma.raw(`${alias}."createdBy"`)}) = ANY(${scope.documentUserIds}::uuid[])`;
  }

  /** Same as `paymentWhere` for raw SQL, on a payments alias. */
  paymentSql(scope: DataScope, alias: string): Prisma.Sql {
    if (!scope.documentUserIds) return Prisma.sql`TRUE`;
    return Prisma.sql`COALESCE(${Prisma.raw(`${alias}."collectedBy"`)}, ${Prisma.raw(`${alias}."receivedBy"`)}) = ANY(${scope.documentUserIds}::uuid[])`;
  }

  /**
   * A client outside the user's scope answers 404, so its existence is not revealed.
   * null (client comptoir) is always allowed.
   */
  async assertClient(db: Db, user: CurrentUserInfo, clientId: string | null): Promise<void> {
    if (!clientId) return;
    const scope = await this.of(user, db);
    if (!scope.clientSellerIds) return;
    const c = await db.client.findFirst({
      where: { id: clientId, ...this.clientWhere(scope) },
      select: { id: true },
    });
    if (!c) throw new AppException(ErrorCode.NOT_FOUND, 'Client not found');
  }

  /**
   * A user who can be put on a sale as its seller, on a versement as its collector, or
   * on a client as his assigned seller: live, of this tenant, with a selling role.
   */
  async assertSeller(db: Db, userId: string): Promise<void> {
    const u = await db.user.findFirst({
      where: { id: userId, deletedAt: null, role: { in: [...SELLING_ROLES] } },
      select: { id: true },
    });
    if (!u) {
      throw new AppException(ErrorCode.SELLER_NOT_ALLOWED, 'This user cannot be the seller', {
        userId,
      });
    }
  }

  /**
   * Whether the seller of a validated sale (or the collector of a versement) may still
   * change. Phase 18 refuses it once the month's incentives are approved; until then
   * everything is allowed. Called inside the reassign transaction.
   */
  assertSellerChangeAllowed(
    _db: Db,
    _doc: { kind: 'SALE' | 'PAYMENT'; at: Date },
  ): Promise<void> {
    return Promise.resolve();
  }
}
