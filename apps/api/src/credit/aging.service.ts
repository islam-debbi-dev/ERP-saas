import { Injectable } from '@nestjs/common';
import {
  addBuckets,
  addDays,
  agedOver90,
  AGING_BUCKETS,
  type AgingBucket,
  type AgingDocument,
  type AgingReportDto,
  type AgingRowDto,
  algiersDay,
  type ClientsToRemindDto,
  computeAging,
  type DueChequeDto,
  type DueChequesDto,
  emptyBuckets,
  money,
  type Money,
  toMoneyString,
} from '@erp/shared';
import { algiersMidnight } from '../common/algiers';
import { businessUnit } from '../common/business-unit-sql';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Party = AgingRowDto['party'];

interface PartyAging {
  party: Party;
  balance: Money;
  buckets: Record<AgingBucket, Money>;
  oldestDays: number | null;
  oldestDate: string | null;
}

const day = (d: Date): string => d.toISOString().slice(0, 10);
const bucketStrings = (b: Record<AgingBucket, Money>) =>
  Object.fromEntries(AGING_BUCKETS.map((k) => [k, toMoneyString(b[k])])) as Record<
    AgingBucket,
    string
  >;

/**
 * Balance âgée (phase 21), clients and suppliers. A view on the accounts: the balance
 * is the ledger as of the end of `asOf`, and `computeAging` spreads it over the unpaid
 * documents, so the buckets always sum to it. Read-only raw SQL over sales, purchases,
 * versements and both ledgers, like the other reports.
 */
@Injectable()
export class AgingService {
  constructor(private readonly prisma: PrismaService) {}

  async clients(asOf = algiersDay()): Promise<AgingReportDto> {
    return this.report('clients', asOf, await this.clientAging(asOf));
  }

  async suppliers(asOf = algiersDay()): Promise<AgingReportDto> {
    return this.report('suppliers', asOf, await this.supplierAging(asOf));
  }

  /**
   * What each client owes each dépôt (phase 26) and how much of it is over 90 days, as the
   * balance âgée would age it: the account is split by the dépôt of each ledger entry (a
   * truck's are its dépôt's, none = the dépôt principal's) and each part is aged over that
   * dépôt's documents. A document only counts the versements of its own dépôt: one paid
   * from another dépôt is in that dépôt's part of the ledger, so it lowers that part.
   * One SQL pass returns three sums per part and `agedOver90` gives the 90+ bucket, so the
   * documents never leave the database. Only the parts a live client owes (> 0).
   * `warehouseIds` limits the dépôts (null = all).
   */
  async clientsByUnit(
    defaultWarehouseId: string | null,
    warehouseIds: string[] | null,
    asOf = algiersDay(),
  ): Promise<{ clientId: string; unitId: string; balance: Money; over90: Money }[]> {
    const tenantId = tenantContext.requireTenantId();
    const end = algiersMidnight(addDays(asOf, 1));
    // Over 90 days (`agingBucketOf`): a document of `asOf` − 91 days or older.
    const cutoff = addDays(asOf, -90);
    const e = businessUnit('e."warehouseId"', defaultWarehouseId);
    const s = businessUnit('s."warehouseId"', defaultWarehouseId);
    const p = businessUnit('p."warehouseId"', defaultWarehouseId, 'pw');
    const inReach = (u: Prisma.Sql) =>
      warehouseIds ? Prisma.sql`AND ${u} = ANY(${warehouseIds}::uuid[])` : Prisma.empty;
    const rows = await this.prisma.db.$queryRaw<
      {
        clientId: string;
        unitId: string;
        balance: Prisma.Decimal;
        open: Prisma.Decimal;
        openOver90: Prisma.Decimal;
      }[]
    >`
      WITH parts AS (
        SELECT e."clientId", ${e.unit} AS "unitId", SUM(e.amount) AS balance
        FROM client_ledger_entries e ${e.join}
        JOIN clients c ON c.id = e."clientId" AND c."deletedAt" IS NULL
        WHERE e."tenantId" = ${tenantId}::uuid AND e."createdAt" < ${end}
        GROUP BY 1, 2
        HAVING SUM(e.amount) > 0
      ),
      returned AS (
        SELECT r."saleId", SUM(r."totalTtc") AS amount FROM sale_returns r
        WHERE r."tenantId" = ${tenantId}::uuid AND r."createdAt" < ${end}
        GROUP BY 1
      ),
      paid AS (
        SELECT a."saleId", ${p.unit} AS "unitId", SUM(a.amount) AS amount
        FROM payment_allocations a JOIN payments p ON p.id = a."paymentId" ${p.join}
        WHERE a."tenantId" = ${tenantId}::uuid AND p."receivedAt" < ${end}
          AND (p.status = 'VALID'
               OR (p.status = 'CANCELLED' AND p."cancelledAt" >= ${end})
               OR (p.status = 'BOUNCED' AND p."bouncedAt" >= ${end}))
        GROUP BY 1, 2
      ),
      -- The documents of clientAging: sales as of then, then opening and manual debits.
      docs AS (
        SELECT d."clientId", d."unitId", d.day,
               d.total - COALESCE(ret.amount, 0) - COALESCE(pay.amount, 0) AS "left"
        FROM (
          SELECT s.id, s."clientId", ${s.unit} AS "unitId", s."documentDate" AS day,
                 s."totalTtc" + s.timbre AS total
          FROM sales s ${s.join}
          WHERE s."tenantId" = ${tenantId}::uuid AND s."clientId" IS NOT NULL
            AND s."validatedAt" < ${end}
            AND (s.status = 'VALIDATED' OR (s.status = 'CANCELLED' AND s."cancelledAt" >= ${end}))
            AND NOT EXISTS (SELECT 1 FROM sales b WHERE b."tenantId" = s."tenantId" AND b."invoiceId" = s.id)
        ) d
        LEFT JOIN returned ret ON ret."saleId" = d.id
        LEFT JOIN paid pay ON pay."saleId" = d.id AND pay."unitId" = d."unitId"
        UNION ALL
        SELECT e."clientId", ${e.unit}, (e."createdAt" AT TIME ZONE 'Africa/Algiers')::date, e.amount
        FROM client_ledger_entries e ${e.join}
        WHERE e."tenantId" = ${tenantId}::uuid AND e."createdAt" < ${end} AND e.amount > 0
          AND e.type::text IN ('OPENING', 'ADJUSTMENT')
      )
      SELECT pa."clientId", pa."unitId", pa.balance,
             COALESCE(SUM(d."left") FILTER (WHERE d."left" > 0), 0) AS open,
             COALESCE(SUM(d."left") FILTER (WHERE d."left" > 0 AND d.day < ${cutoff}::date), 0) AS "openOver90"
      FROM parts pa
      LEFT JOIN docs d ON d."clientId" = pa."clientId" AND d."unitId" = pa."unitId"
      WHERE TRUE ${inReach(Prisma.raw('pa."unitId"'))}
      GROUP BY 1, 2, 3`;
    return rows.map((r) => {
      const balance = money(r.balance.toString());
      return {
        clientId: r.clientId,
        unitId: r.unitId,
        balance,
        over90: agedOver90(r.open.toString(), r.openOver90.toString(), balance),
      };
    });
  }

  /** Clients who owe and whose oldest unpaid amount is older than the tenant's threshold. */
  async toRemind(): Promise<ClientsToRemindDto> {
    const { reminderDays } = await this.prisma.db.tenant.findUniqueOrThrow({
      where: { id: tenantContext.requireTenantId() },
      select: { reminderDays: true },
    });
    const rows = await this.clientAging(algiersDay(), { activeOnly: true });
    return {
      reminderDays,
      items: rows
        .filter(
          (r) =>
            r.balance.gt(0) &&
            r.oldestDays !== null &&
            r.oldestDate !== null &&
            r.oldestDays > reminderDays,
        )
        .sort((a, b) => (b.oldestDays ?? 0) - (a.oldestDays ?? 0) || b.balance.cmp(a.balance))
        .map((r) => ({
          client: {
            id: r.party.id,
            code: r.party.code ?? '',
            name: r.party.name,
            phone: r.party.phone,
          },
          balance: toMoneyString(r.balance),
          oldestDate: r.oldestDate ?? '',
          oldestDays: r.oldestDays ?? 0,
        })),
    };
  }

  /** Valid cheques with an échéance from today to 6 days later (Algiers). */
  async dueCheques(today = algiersDay()): Promise<DueChequesDto> {
    const to = addDays(today, 6);
    const from = new Date(`${today}T00:00:00.000Z`);
    const until = new Date(`${to}T00:00:00.000Z`);
    const [clientRows, supplierRows] = await Promise.all([
      this.prisma.db.payment.findMany({
        where: { mode: 'CHEQUE', status: 'VALID', dueDate: { gte: from, lte: until } },
        include: { client: { select: { id: true, name: true } } },
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.db.supplierPayment.findMany({
        where: { mode: 'CHEQUE', status: 'VALID', dueDate: { gte: from, lte: until } },
        include: { supplier: { select: { id: true, name: true } } },
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const group = (
      rows: {
        id: string;
        number: string;
        amount: Prisma.Decimal;
        reference: string | null;
        bank: string | null;
        dueDate: Date | null;
        party: { id: string; name: string } | null;
      }[],
    ) => {
      const items: DueChequeDto[] = rows.map((r) => ({
        id: r.id,
        number: r.number,
        party: r.party,
        amount: toMoneyString(r.amount.toString()),
        reference: r.reference,
        bank: r.bank,
        dueDate: r.dueDate ? day(r.dueDate) : today,
      }));
      const total = rows.reduce((s, r) => s.plus(r.amount.toString()), money(0));
      return { count: items.length, total: toMoneyString(total), items };
    };
    return {
      from: today,
      to,
      client: group(clientRows.map((r) => ({ ...r, party: r.client }))),
      supplier: group(supplierRows.map((r) => ({ ...r, party: r.supplier }))),
    };
  }

  // ---------------------------------------------------------------- internals

  private report(kind: AgingReportDto['kind'], asOf: string, rows: PartyAging[]): AgingReportDto {
    const totals = emptyBuckets();
    let balance = money(0);
    for (const r of rows) {
      addBuckets(totals, r.buckets);
      balance = balance.plus(r.balance);
    }
    return {
      kind,
      asOf,
      rows: rows
        .sort((a, b) => b.balance.cmp(a.balance) || a.party.name.localeCompare(b.party.name))
        .map((r) => ({
          party: r.party,
          balance: toMoneyString(r.balance),
          buckets: bucketStrings(r.buckets),
          oldestDays: r.oldestDays,
        })),
      totals: { balance: toMoneyString(balance), buckets: bucketStrings(totals) },
    };
  }

  private async clientAging(
    asOf: string,
    options: { activeOnly?: boolean } = {},
  ): Promise<PartyAging[]> {
    const tenantId = tenantContext.requireTenantId();
    const end = algiersMidnight(addDays(asOf, 1));
    const balances = await this.prisma.db.$queryRaw<
      { id: string; code: string; name: string; phone: string | null; balance: Prisma.Decimal }[]
    >`
      SELECT c.id, c.code, c.name, c.phone, SUM(e.amount) AS balance
      FROM client_ledger_entries e JOIN clients c ON c.id = e."clientId"
      WHERE e."tenantId" = ${tenantId}::uuid AND e."createdAt" < ${end}
        ${options.activeOnly ? Prisma.sql`AND c."deletedAt" IS NULL AND c.active = true` : Prisma.empty}
      GROUP BY c.id, c.code, c.name, c.phone
      HAVING SUM(e.amount) <> 0`;
    if (balances.length === 0) return [];

    // The documents that moved the account as of `asOf`, as PaymentsService.unpaid sees
    // them today: a facture grouping BLs has no effect of its own, a document cancelled
    // later still counted then, and so did a versement cancelled or bounced later.
    const docs = await this.prisma.db.$queryRaw<
      {
        partyId: string;
        date: Date;
        total: Prisma.Decimal;
        returned: Prisma.Decimal;
        paid: Prisma.Decimal;
      }[]
    >`
      SELECT s."clientId" AS "partyId", s."documentDate" AS date, s."totalTtc" + s.timbre AS total,
        COALESCE((SELECT SUM(r."totalTtc") FROM sale_returns r
                  WHERE r."tenantId" = s."tenantId" AND r."saleId" = s.id
                    AND r."createdAt" < ${end}), 0) AS returned,
        COALESCE((SELECT SUM(a.amount) FROM payment_allocations a
                  JOIN payments p ON p.id = a."paymentId"
                  WHERE a."tenantId" = s."tenantId" AND a."saleId" = s.id AND p."receivedAt" < ${end}
                    AND (p.status = 'VALID'
                         OR (p.status = 'CANCELLED' AND p."cancelledAt" >= ${end})
                         OR (p.status = 'BOUNCED' AND p."bouncedAt" >= ${end}))), 0) AS paid
      FROM sales s
      WHERE s."tenantId" = ${tenantId}::uuid AND s."clientId" IS NOT NULL
        AND s."validatedAt" < ${end}
        AND (s.status = 'VALIDATED' OR (s.status = 'CANCELLED' AND s."cancelledAt" >= ${end}))
        AND NOT EXISTS (SELECT 1 FROM sales b WHERE b."tenantId" = s."tenantId" AND b."invoiceId" = s.id)`;
    const debits = await this.datedDebits('client_ledger_entries', 'clientId', end, [
      'OPENING',
      'ADJUSTMENT',
    ]);
    return this.combine(
      balances.map((b) => ({
        party: { id: b.id, code: b.code, name: b.name, phone: b.phone },
        balance: b.balance,
      })),
      docs,
      debits,
      asOf,
    );
  }

  private async supplierAging(asOf: string): Promise<PartyAging[]> {
    const tenantId = tenantContext.requireTenantId();
    const end = algiersMidnight(addDays(asOf, 1));
    const balances = await this.prisma.db.$queryRaw<
      {
        id: string;
        code: string | null;
        name: string;
        phone: string | null;
        balance: Prisma.Decimal;
      }[]
    >`
      SELECT s.id, s.code, s.name, s.phone, SUM(e.amount) AS balance
      FROM supplier_ledger_entries e JOIN suppliers s ON s.id = e."supplierId"
      WHERE e."tenantId" = ${tenantId}::uuid AND e."createdAt" < ${end}
      GROUP BY s.id, s.code, s.name, s.phone
      HAVING SUM(e.amount) <> 0`;
    if (balances.length === 0) return [];
    // Règlements are not allocated to BRs: they pay the oldest first (computeAging).
    const docs = await this.prisma.db.$queryRaw<
      {
        partyId: string;
        date: Date;
        total: Prisma.Decimal;
        returned: Prisma.Decimal;
        paid: Prisma.Decimal;
      }[]
    >`
      SELECT p."supplierId" AS "partyId", p."documentDate" AS date, p."totalTtc" AS total,
        COALESCE((SELECT SUM(r."totalTtc") FROM purchase_returns r
                  WHERE r."purchaseId" = p.id AND r."createdAt" < ${end}), 0) AS returned,
        p."paidAmount" AS paid
      FROM purchases p
      WHERE p."tenantId" = ${tenantId}::uuid AND p."validatedAt" < ${end}
        AND (p.status = 'VALIDATED' OR (p.status = 'CANCELLED' AND p."cancelledAt" >= ${end}))`;
    const debits = await this.datedDebits('supplier_ledger_entries', 'supplierId', end, [
      'OPENING',
      'ADJUST',
    ]);
    return this.combine(
      balances.map((b) => ({
        party: { id: b.id, code: b.code, name: b.name, phone: b.phone },
        balance: b.balance,
      })),
      docs,
      debits,
      asOf,
    );
  }

  /** Opening balances and manual debits, dated by their entry (Algiers day). */
  private async datedDebits(
    table: 'client_ledger_entries' | 'supplier_ledger_entries',
    partyColumn: 'clientId' | 'supplierId',
    end: Date,
    types: string[],
  ): Promise<{ partyId: string; date: string; total: Prisma.Decimal }[]> {
    const tenantId = tenantContext.requireTenantId();
    // Both identifiers come from the literal unions above, never from input.
    return this.prisma.db.$queryRawUnsafe(
      `SELECT "${partyColumn}" AS "partyId",
              to_char(("createdAt" AT TIME ZONE 'Africa/Algiers')::date, 'YYYY-MM-DD') AS date,
              amount AS total
       FROM ${table}
       WHERE "tenantId" = $1::uuid AND "createdAt" < $2 AND amount > 0
         AND type::text = ANY($3::text[])`,
      tenantId,
      end,
      types,
    );
  }

  private combine(
    balances: { party: Party; balance: Prisma.Decimal }[],
    docs: {
      partyId: string;
      date: Date;
      total: Prisma.Decimal;
      returned: Prisma.Decimal;
      paid: Prisma.Decimal;
    }[],
    debits: { partyId: string; date: string; total: Prisma.Decimal }[],
    asOf: string,
  ): PartyAging[] {
    const byParty = new Map<string, AgingDocument[]>();
    const push = (id: string, d: AgingDocument) => {
      const list = byParty.get(id);
      if (list) list.push(d);
      else byParty.set(id, [d]);
    };
    for (const d of docs) {
      push(d.partyId, {
        date: day(d.date),
        total: d.total.toString(),
        returned: d.returned.toString(),
        paid: d.paid.toString(),
      });
    }
    for (const d of debits) push(d.partyId, { date: d.date, total: d.total.toString() });
    return balances.map((b) => {
      const result = computeAging(byParty.get(b.party.id) ?? [], b.balance.toString(), asOf);
      return { party: b.party, balance: money(b.balance.toString()), ...result };
    });
  }
}
