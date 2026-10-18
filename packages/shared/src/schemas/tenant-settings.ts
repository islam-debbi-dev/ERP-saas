import { z } from 'zod';
import { CreditLimitMode, NegativeStockMode } from '../enums';
import { amountString, percentString } from './common';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();

const timbreRateString = percentString(4);

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
  // Timbre fiscal rule: off by default; values come from the current loi de finances.
  timbreEnabled: z.boolean(),
  timbreRate: timbreRateString.nullable(),
  timbreMin: amountString.nullable(),
  timbreMax: amountString.nullable(),
  timbreThreshold: amountString.nullable(),
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
