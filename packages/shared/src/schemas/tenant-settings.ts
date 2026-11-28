import { z } from 'zod';
import {
  CreditLimitMode,
  GEO_CHECK_MODES,
  NegativeStockMode,
  PrintFormat,
  SELLER_SCOPES,
  type SellerScope,
  LIVREUR_SCOPES,
  type LivreurScope,
} from '../enums';
import { parseDA } from '../money';
import { amountString, percentString } from './common';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();

/** One tranche of the timbre rule; the last one is open-ended (`upTo: null`). */
export const timbreTrancheSchema = z.object({
  upTo: amountString.nullable(),
  rate: percentString(4),
});

/** Tranches in increasing order, only the last one open-ended. */
export const timbreTranchesSchema = z
  .array(timbreTrancheSchema)
  .max(10)
  .refine(
    (tranches) =>
      tranches.every((t, i) => {
        const last = i === tranches.length - 1;
        if (t.upTo === null) return last;
        const prev = tranches[i - 1]?.upTo;
        const bound = parseDA(t.upTo);
        return !prev || (bound !== null && bound.gt(parseDA(prev) ?? 0));
      }),
    'invalid_tranches',
  );

export const DEFAULT_TVA_MENTION = 'Non assujetti à la TVA';

/** Tenant settings, see the settings table in docs/domain.md. */
export const tenantSettingsSchema = z.object({
  // Invoice header
  raisonSociale: z.string().trim().min(2).max(160),
  adresse: optionalText(255),
  telephone: optionalText(40),
  rc: optionalText(40),
  nif: optionalText(40),
  nis: optionalText(40),
  ai: optionalText(40),
  rib: optionalText(60),
  // Business rules
  assujettiTva: z.boolean(),
  creditLimitMode: z.enum([CreditLimitMode.WARN, CreditLimitMode.BLOCK]),
  negativeStockMode: z.enum([
    NegativeStockMode.ALLOW,
    NegativeStockMode.WARN,
    NegativeStockMode.BLOCK,
  ]),
  priceLevelCount: z.number().int().min(1).max(5),
  /** Line discount any seller may give; above it needs DISCOUNT_ABOVE_X. 0 = every discount. */
  maxDiscountPct: percentString(2),
  /** "Clients à relancer": balance > 0 and oldest unpaid document older than this (days). */
  reminderDays: z.number().int().min(1).max(365),
  /** Which clients a seller sees when SALES_FORCE is on (phase 14). */
  sellerScope: z.enum(SELLER_SCOPES as [SellerScope, ...SellerScope[]]),
  /** Under BY_ZONE, a seller also sees the clients assigned to him (phase 40b). */
  zoneIncludesAssigned: z.boolean(),
  /** Which clients a livreur sees when SALES_FORCE is on: all, or those he delivers to. */
  livreurScope: z.enum(LIVREUR_SCOPES as [LivreurScope, ...LivreurScope[]]),
  /** Géolocalisation (phase 17, GEO_CHECK): what happens to a far operation. */
  geoCheckMode: z.enum(GEO_CHECK_MODES),
  /** Distance from the client's point still counted as "at the client", in metres. */
  geoRadiusM: z.number().int().min(20).max(5000),
  /** A position less precise than this is LOW_ACCURACY, in metres. */
  geoMaxAccuracyM: z.number().int().min(10).max(5000),
  // Timbre fiscal rule: off by default; values come from the current loi de finances.
  timbreEnabled: z.boolean(),
  timbreTranches: timbreTranchesSchema,
  timbreMin: amountString.nullable(),
  timbreMax: amountString.nullable(),
  timbreThreshold: amountString.nullable(),
  /** A comptage de caisse with an écart from this amount up alerts the owner (phase 34). */
  cashCountAlertThreshold: amountString,
  /** Objectif de ventes TTC du mois (phase 33), shown on the dashboard; null = none. OWNER only. */
  monthlySalesTarget: amountString
    .refine((v) => parseDA(v)?.isZero() === false, 'invalid_amount')
    .nullable(),
  // Printed documents
  defaultPrintFormat: z.enum([PrintFormat.A4, PrintFormat.A5]),
  documentFooter: optionalText(500),
  /** Printed on documents of a tenant that is not assujetti à la TVA. */
  tvaMention: z.string().trim().min(1).max(120),
});
export type TenantSettings = z.infer<typeof tenantSettingsSchema>;
/** What the API returns: same fields, amounts as canonical strings. */
export type TenantSettingsResponse = z.output<typeof tenantSettingsSchema> & {
  tenantId: string;
  name: string;
  updatedAt: string;
};

// strict(): unknown keys (e.g. a tenantId in the body) are rejected, not silently dropped.
export const updateTenantSettingsSchema = tenantSettingsSchema.partial().strict();
export type UpdateTenantSettingsInput = z.infer<typeof updateTenantSettingsSchema>;
