import { z } from 'zod';
import { CreditLimitMode, NegativeStockMode } from '../enums';
import { parseDA } from '../money';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();

/** A non-negative money amount sent as a string (`"1500.00"`, `"1 500,00"`). */
const moneyString = z.string().refine((v) => {
  const parsed = parseDA(v);
  return parsed !== null && !parsed.isNegative() && parsed.decimalPlaces() <= 2;
}, 'invalid_amount');

/** A rate in percent, 0 to 100, at most 4 decimals (e.g. `"1"` for 1 %). */
const percentString = z.string().refine((v) => {
  const parsed = parseDA(v);
  return parsed !== null && !parsed.isNegative() && parsed.lte(100) && parsed.decimalPlaces() <= 4;
}, 'invalid_rate');

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
  timbreRate: percentString.nullable(),
  timbreMin: moneyString.nullable(),
  timbreMax: moneyString.nullable(),
  timbreThreshold: moneyString.nullable(),
});
export type TenantSettings = z.infer<typeof tenantSettingsSchema>;
/** What the API returns: same fields, amounts as canonical strings. */
export type TenantSettingsResponse = z.output<typeof tenantSettingsSchema> & {
  tenantId: string;
  name: string;
  updatedAt: string;
};

export const updateTenantSettingsSchema = tenantSettingsSchema.partial();
export type UpdateTenantSettingsInput = z.infer<typeof updateTenantSettingsSchema>;
