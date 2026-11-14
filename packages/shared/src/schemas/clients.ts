import { z } from 'zod';
import { ClientType, type ClientLedgerType } from '../enums';
import { parseDA } from '../money';
import { amountString, decimalQuery, normalizeDecimal, searchText, fitsMoney } from './common';
import { type ClientLocationDto } from './geo';

const id = z.uuid();
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .default(null);
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date');

/** A signed money amount (`-2 000`, `32000.50`), max 2 decimals. */
const signedAmount = (opts: { nonZero: boolean }) =>
  z
    .string()
    .refine((v) => {
      const parsed = parseDA(v);
      if (parsed === null || parsed.decimalPlaces() > 2 || !fitsMoney(parsed)) return false;
      return opts.nonZero ? !parsed.isZero() : true;
    }, 'invalid_amount')
    .transform(normalizeDecimal);

const clientFields = {
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(160),
  type: z.enum([ClientType.PARTICULIER, ClientType.PROFESSIONNEL]).default(ClientType.PARTICULIER),
  phone: optionalText(40),
  phone2: optionalText(40),
  address: optionalText(255),
  wilaya: optionalText(60),
  commune: optionalText(80),
  rc: optionalText(40),
  nif: optionalText(40),
  nis: optionalText(40),
  ai: optionalText(40),
  priceLevelId: id.nullable().default(null),
  /** Plafond de crédit; null = no limit. */
  creditLimit: amountString.transform(normalizeDecimal).nullable().default(null),
  notes: optionalText(500),
  active: z.boolean().default(true),
  /** SALES_FORCE only. Omitted = unchanged (none on create); null clears it. */
  sectorId: id.nullable().optional(),
  assignedSellerId: id.nullable().optional(),
};

export const createClientSchema = z.object(clientFields);
export type CreateClientInput = z.infer<typeof createClientSchema>;

export const updateClientSchema = z.object({ ...clientFields, version: z.number().int().min(1) });
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

export const clientListQuerySchema = z.object({
  search: searchText().optional(),
  hasDebt: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  overLimit: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  sectorId: id.optional(),
  assignedSellerId: id.optional(),
  /** Only clients without a sector / without a seller. */
  unassigned: z.enum(['sector', 'seller']).optional(),
  /** Phase 35: only clients with (true) / without (false) a saved GPS point; omitted = all. */
  hasLocation: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  /** `balance_desc`: who owes the most first (the dashboard's crédit card, phase 33). Default by name. */
  sort: z.enum(['name', 'balance_desc']).default('name'),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ClientListQuery = z.infer<typeof clientListQuerySchema>;

// ---------------------------------------------------------------- client map (phase 35)

/** Most points `/clients/map` returns at once; above it the web asks to zoom in or filter. */
export const MAP_POINTS_MAX = 2000;

const flag = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');

/** The client-list filters the map and the nearby list share. */
const mapFilterFields = {
  search: clientListQuerySchema.shape.search,
  sectorId: id.optional(),
  assignedSellerId: id.optional(),
  hasDebt: flag,
  overLimit: flag,
  /** Inactive clients (`active = false`) are left out unless asked for. */
  includeInactive: flag,
};

const latQ = decimalQuery.pipe(z.number().min(-90).max(90));
const lngQ = decimalQuery.pipe(z.number().min(-180).max(180));

export const clientMapQuerySchema = z
  .object({
    ...mapFilterFields,
    /** Optional view box: all four or none. */
    minLat: latQ.optional(),
    minLng: lngQ.optional(),
    maxLat: latQ.optional(),
    maxLng: lngQ.optional(),
  })
  .superRefine((q, ctx) => {
    const box = [q.minLat, q.minLng, q.maxLat, q.maxLng];
    const given = box.filter((v) => v !== undefined).length;
    if (given !== 0 && given !== 4) {
      ctx.addIssue({ code: 'custom', message: 'incomplete_bounds', path: ['minLat'] });
      return;
    }
    if (given === 4 && (q.minLat! >= q.maxLat! || q.minLng! >= q.maxLng!)) {
      ctx.addIssue({ code: 'custom', message: 'invalid_bounds', path: ['maxLat'] });
    }
  });
export type ClientMapQuery = z.infer<typeof clientMapQuerySchema>;

export const clientNearbyQuerySchema = z.object({
  ...mapFilterFields,
  lat: latQ,
  lng: lngQ,
  radiusM: z.coerce.number().int().min(100).max(50_000).default(5000),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ClientNearbyQuery = z.infer<typeof clientNearbyQuerySchema>;

/**
 * The same request as a JSON body (`POST /clients/nearby`), which is what the web sends:
 * a hosting platform keeps the query string of every request in its logs, where no scrub
 * of ours can reach (REPORT-35, B-3). A body is not logged. Parses to `ClientNearbyQuery`.
 */
export const clientNearbyBodySchema = z.object({
  search: mapFilterFields.search,
  sectorId: id.optional(),
  assignedSellerId: id.optional(),
  hasDebt: z.boolean().default(false),
  overLimit: z.boolean().default(false),
  includeInactive: z.boolean().default(false),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusM: z.number().int().min(100).max(50_000).default(5000),
  limit: z.number().int().min(1).max(100).default(30),
}) satisfies z.ZodType<ClientNearbyQuery>;
export type ClientNearbyBody = z.input<typeof clientNearbyBodySchema>;

/** A compact client for the map: no ledger, no address beyond the commune. */
export interface ClientMapPointDto {
  id: string;
  code: string;
  name: string;
  commune: string | null;
  phone: string | null;
  lat: number;
  lng: number;
  active: boolean;
  /** Decimal string, `"1234.50"`. */
  balance: string;
  overLimit: boolean;
  sectorId: string | null;
  assignedSellerId: string | null;
}

export interface ClientMapDto {
  points: ClientMapPointDto[];
  /** More clients matched than MAP_POINTS_MAX: zoom in or filter. */
  truncated: boolean;
  /** Clients matching the same filters that have no saved point yet. */
  withoutLocation: number;
}

export interface ClientNearbyPointDto extends ClientMapPointDto {
  /** Straight-line distance in whole metres. */
  distanceM: number;
}

/** Can be negative (an avoir in the client's favour); zero has nothing to record. */
export const openingBalanceSchema = z.object({
  amount: signedAmount({ nonZero: true }),
  note: optionalText(255),
  /** The dépôt the debt belongs to (phase 24); omitted = the dépôt principal. */
  warehouseId: id.optional(),
});
export type OpeningBalanceInput = z.infer<typeof openingBalanceSchema>;

export const clientAdjustmentSchema = z.object({
  /** + the client owes more, - the client owes less. */
  amount: signedAmount({ nonZero: true }),
  reason: z.string().trim().min(3).max(255),
  /** The dépôt the adjustment belongs to (phase 24); omitted = the dépôt principal. */
  warehouseId: id.optional(),
});
export type ClientAdjustmentInput = z.infer<typeof clientAdjustmentSchema>;

export const statementQuerySchema = z
  .object({ from: dateString, to: dateString })
  .refine((q) => q.from <= q.to, { message: 'invalid_range', path: ['to'] });
export type StatementQuery = z.infer<typeof statementQuerySchema>;

export const debtorsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
});
export type DebtorsQuery = z.infer<typeof debtorsQuerySchema>;

// ---------------------------------------------------------------- responses

export interface ClientDto {
  id: string;
  code: string;
  name: string;
  type: ClientType;
  phone: string | null;
  phone2: string | null;
  address: string | null;
  wilaya: string | null;
  commune: string | null;
  rc: string | null;
  nif: string | null;
  nis: string | null;
  ai: string | null;
  priceLevelId: string | null;
  creditLimit: string | null;
  sector: { id: string; name: string } | null;
  assignedSeller: { id: string; fullName: string } | null;
  notes: string | null;
  active: boolean;
  version: number;
  archivedAt: string | null;
  /** Positive = owes us; negative = credit in the client's favour. */
  balance: string;
  hasOpening: boolean;
  overLimit: boolean;
  /** Reference GPS point (phase 17); null until someone saves it. */
  location: ClientLocationDto | null;
  /**
   * What the client owes in each dépôt (phase 24, MULTI_UNIT): one account, the amounts
   * add up to `balance`. Only on the client's own page.
   */
  debtByWarehouse?: ClientDebtByWarehouseDto[];
}

export interface ClientPage {
  items: ClientDto[];
  nextCursor: string | null;
}

export interface ClientLedgerEntryDto {
  id: string;
  type: ClientLedgerType;
  amount: string;
  label: string;
  reason: string | null;
  refType: string | null;
  refId: string | null;
  createdBy: { id: string; fullName: string } | null;
  createdAt: string;
  /** Balance right after this entry. */
  runningBalance: string;
  /** The dépôt the entry belongs to (phase 24); null before the backfill. */
  warehouse: { id: string; name: string } | null;
  /**
   * A dépôt the user does not work in: only date, type, number (`label`), amount and dépôt
   * are given; reason, refId and createdBy are null and the document cannot be opened.
   */
  reduced: boolean;
}

/** What the client owes in each dépôt (phase 24); the amounts add up to the balance. */
export interface ClientDebtByWarehouseDto {
  warehouse: { id: string; name: string } | null;
  balance: string;
}

export interface ClientStatementDto {
  client: { id: string; code: string; name: string };
  from: string;
  to: string;
  openingBalance: string;
  entries: ClientLedgerEntryDto[];
  closingBalance: string;
  totalDebit: string;
  totalCredit: string;
}

export interface DebtorDto {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  balance: string;
  creditLimit: string | null;
}

export interface ClientReconcileReport {
  checkedClients: number;
  differences: { clientId: string; cachedBalance: string; ledgerBalance: string }[];
}

export type CreditCheckStatus = 'OK' | 'WARN' | 'BLOCK';

export interface CreditCheckResult {
  status: CreditCheckStatus;
  balance: string;
  limit: string | null;
  projected: string;
}
