import { WILAYAS } from '@erp/shared';
import { communesOf, findWilaya } from '@erp/shared/communes';

/**
 * What the statistics need of the commune list (phase 40a). The daïra is never stored: SQL
 * gets it from the commune code through these two parallel arrays.
 */
const COMMUNES = WILAYAS.flatMap((w) => communesOf(w.code)).filter((c) => c.dairaKey !== null);

export const DAIRA_OF_COMMUNE: { codes: number[]; keys: string[] } = {
  codes: COMMUNES.map((c) => c.code),
  keys: COMMUNES.map((c) => c.dairaKey!),
};

export function communeCodesOfDairas(dairaKeys: readonly string[]): number[] {
  const wanted = new Set(dairaKeys);
  return COMMUNES.filter((c) => wanted.has(c.dairaKey!)).map((c) => c.code);
}

/**
 * The `clientWilayas` filter as wilaya numbers: numbers, and (deprecated, old links) names.
 * A value that is neither is dropped here, so that a filter of only such values matches no
 * client instead of every one.
 */
export function wilayaCodesOf(values: readonly string[]): number[] {
  return values.map(findWilaya).filter((code) => code !== null);
}
