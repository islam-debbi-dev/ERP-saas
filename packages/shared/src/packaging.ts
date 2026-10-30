/**
 * Emballages consignés (phase 20, module PACKAGING): counts only, no money. A client's
 * count goes up when packaging is delivered with goods and down when he brings it back.
 */
import { qty, type QtyInput } from './quantity';

export const PackagingEntryType = {
  DELIVERY: 'DELIVERY',
  RETURN: 'RETURN',
  OPENING: 'OPENING',
  ADJUST: 'ADJUST',
  REVERSAL: 'REVERSAL',
} as const;
export type PackagingEntryType = (typeof PackagingEntryType)[keyof typeof PackagingEntryType];
export const PACKAGING_ENTRY_TYPES = Object.values(PackagingEntryType);

export interface ProductPackagingRule {
  productId: string;
  packagingTypeId: string;
  /** Base units carried by one packaging (24 bouteilles per casier). */
  qtyBasePerPackaging: QtyInput;
}

/**
 * Packaging given with these lines, per packaging type: each line needs
 * ceil(qtyBase / per packaging) (30 bouteilles = 2 casiers, the second one not full).
 * Free lines count too: they travel in the same casiers. Types with 0 are left out.
 */
export function packagingGiven(
  lines: readonly { productId: string; qtyBase: QtyInput }[],
  rules: readonly ProductPackagingRule[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of lines) {
    const base = qty(line.qtyBase);
    if (base.lte(0)) continue;
    for (const r of rules) {
      if (r.productId !== line.productId) continue;
      const per = qty(r.qtyBasePerPackaging);
      if (per.lte(0)) continue;
      const count = base.div(per).ceil().toNumber();
      out.set(r.packagingTypeId, (out.get(r.packagingTypeId) ?? 0) + count);
    }
  }
  return out;
}
