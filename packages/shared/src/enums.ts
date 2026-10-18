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
