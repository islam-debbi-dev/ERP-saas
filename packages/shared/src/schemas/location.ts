import { z } from 'zod';
import { WILAYA_MAX, WILAYA_MIN } from '../wilayas';

/**
 * Location codes sent on a client or a sector (phase 40a). Whether a commune exists, matches
 * the wilaya or is still under review is decided by the API (`COMMUNE_*` errors), so this
 * file does not load the commune data.
 */
export const wilayaCodeInput = z
  .number()
  .int()
  .min(WILAYA_MIN)
  .max(WILAYA_MAX)
  .nullable()
  .optional();
export const communeCodeInput = z.number().int().positive().nullable().optional();
