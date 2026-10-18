/** Enums shared by the API (mirrored in the Prisma schema) and the web app. */

export const Role = {
  OWNER: 'OWNER',
  MANAGER: 'MANAGER',
  SELLER: 'SELLER',
  STOREKEEPER: 'STOREKEEPER',
} as const;
export type Role = (typeof Role)[keyof typeof Role];
export const ROLES = Object.values(Role);

/** Document types with their own numbering sequence. See docs/domain.md glossary. */
export const DocType = {
  BL: 'BL',
  FAC: 'FAC',
  AV: 'AV',
  BR: 'BR',
  VER: 'VER',
  /** Inventaire (physical stock count). */
  INV: 'INV',
} as const;
export type DocType = (typeof DocType)[keyof typeof DocType];
export const DOC_TYPES = Object.values(DocType);

export const CreditLimitMode = {
  WARN: 'WARN',
  BLOCK: 'BLOCK',
} as const;
export type CreditLimitMode = (typeof CreditLimitMode)[keyof typeof CreditLimitMode];

export const NegativeStockMode = {
  ALLOW: 'ALLOW',
  WARN: 'WARN',
  BLOCK: 'BLOCK',
} as const;
export type NegativeStockMode = (typeof NegativeStockMode)[keyof typeof NegativeStockMode];

/**
 * Units every tenant starts with. Codes are stable identifiers translated in the
 * UI (`units.PIECE` …); tenants can add custom units with a free-text name.
 */
export const DEFAULT_UNITS = [
  { code: 'PIECE', allowsDecimal: false },
  { code: 'KG', allowsDecimal: true },
  { code: 'LITRE', allowsDecimal: true },
  { code: 'METRE', allowsDecimal: true },
  { code: 'CARTON', allowsDecimal: false },
  { code: 'FARDEAU', allowsDecimal: false },
  { code: 'SAC', allowsDecimal: false },
  { code: 'BOITE', allowsDecimal: false },
  { code: 'PAQUET', allowsDecimal: false },
] as const;
export type DefaultUnitCode = (typeof DEFAULT_UNITS)[number]['code'];

/** Names given to price levels 1..5 when a tenant is created; editable afterwards. */
export const DEFAULT_PRICE_LEVEL_NAMES = [
  'Gros',
  'Demi-gros',
  'Détail',
  'Niveau 4',
  'Niveau 5',
] as const;
export const MAX_PRICE_LEVELS = 5;

/**
 * TVA rates offered in the product form. Only a UI shortcut: the rate is stored
 * on each product and the API accepts any value between 0 and 100.
 */
export const COMMON_TVA_RATES = ['0', '9', '19'] as const;

export const StockMovementType = {
  OPENING: 'OPENING',
  PURCHASE: 'PURCHASE',
  PURCHASE_RETURN: 'PURCHASE_RETURN',
  SALE: 'SALE',
  SALE_RETURN: 'SALE_RETURN',
  ADJUSTMENT: 'ADJUSTMENT',
  INVENTORY: 'INVENTORY',
} as const;
export type StockMovementType = (typeof StockMovementType)[keyof typeof StockMovementType];

export const AdjustmentReason = {
  CASSE: 'CASSE',
  PERTE: 'PERTE',
  ERREUR: 'ERREUR',
  AUTRE: 'AUTRE',
} as const;
export type AdjustmentReason = (typeof AdjustmentReason)[keyof typeof AdjustmentReason];
export const ADJUSTMENT_REASONS = Object.values(AdjustmentReason);

export const InventoryStatus = {
  OPEN: 'OPEN',
  VALIDATED: 'VALIDATED',
  CANCELLED: 'CANCELLED',
} as const;
export type InventoryStatus = (typeof InventoryStatus)[keyof typeof InventoryStatus];
