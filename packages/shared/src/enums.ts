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
  /** Retour fournisseur (partial return of a bon de réception). */
  RF: 'RF',
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

export const PurchaseStatus = {
  DRAFT: 'DRAFT',
  VALIDATED: 'VALIDATED',
  CANCELLED: 'CANCELLED',
} as const;
export type PurchaseStatus = (typeof PurchaseStatus)[keyof typeof PurchaseStatus];

export const ClientType = {
  PARTICULIER: 'PARTICULIER',
  PROFESSIONNEL: 'PROFESSIONNEL',
} as const;
export type ClientType = (typeof ClientType)[keyof typeof ClientType];

/** Client account entries. Positive amounts mean the client owes more. */
export const ClientLedgerType = {
  OPENING: 'OPENING',
  SALE: 'SALE',
  PAYMENT: 'PAYMENT',
  RETURN: 'RETURN',
  ADJUSTMENT: 'ADJUSTMENT',
  REVERSAL: 'REVERSAL',
} as const;
export type ClientLedgerType = (typeof ClientLedgerType)[keyof typeof ClientLedgerType];

export const SaleType = {
  /** Bon de livraison: the everyday sale document. */
  BL: 'BL',
  FACTURE: 'FACTURE',
} as const;
export type SaleType = (typeof SaleType)[keyof typeof SaleType];

export const SaleStatus = {
  DRAFT: 'DRAFT',
  VALIDATED: 'VALIDATED',
  CANCELLED: 'CANCELLED',
} as const;
export type SaleStatus = (typeof SaleStatus)[keyof typeof SaleStatus];

export const PaymentMode = {
  ESPECES: 'ESPECES',
  CHEQUE: 'CHEQUE',
  VIREMENT: 'VIREMENT',
} as const;
export type PaymentMode = (typeof PaymentMode)[keyof typeof PaymentMode];
export const PAYMENT_MODES = Object.values(PaymentMode);

export const PaymentStatus = {
  VALID: 'VALID',
  CANCELLED: 'CANCELLED',
  BOUNCED: 'BOUNCED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

/** What happens to goods a client brings back. */
export const ReturnDisposition = {
  /** Back on the shelf. */
  RESTOCK: 'RESTOCK',
  /** Taken back but unsellable: returned then written off (ADJUSTMENT, CASSE). */
  DAMAGED: 'DAMAGED',
} as const;
export type ReturnDisposition = (typeof ReturnDisposition)[keyof typeof ReturnDisposition];
