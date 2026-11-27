/**
 * Excel / CSV import helpers shared by the API (parsing, validation) and the web
 * (mapping screen). Pure functions: no I/O.
 */
import { DEFAULT_UNITS, type DefaultUnitCode } from './enums';
import { MoneyDecimal, type Money } from './money';

export const ImportType = {
  PRODUCTS: 'PRODUCTS',
  OPENING_STOCK: 'OPENING_STOCK',
  CLIENTS: 'CLIENTS',
  /** Fournisseurs et soldes (phase 21). */
  SUPPLIERS: 'SUPPLIERS',
  /** Emballages chez les clients, opening counts (phase 20, PACKAGING). */
  PACKAGING_OPENING: 'PACKAGING_OPENING',
  /** Personnel, with opening congé and avance balances (phase 31, HR). */
  EMPLOYEES: 'EMPLOYEES',
} as const;
export type ImportType = (typeof ImportType)[keyof typeof ImportType];
export const IMPORT_TYPES = Object.values(ImportType);

export const ImportStatus = {
  PREVIEWED: 'PREVIEWED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;
export type ImportStatus = (typeof ImportStatus)[keyof typeof ImportStatus];

/** Hard limits for one import (the confirm runs in a single transaction). */
export const IMPORT_MAX_ROWS = 10_000;
export const IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;
/** How long the original file is kept for audit. */
export const IMPORT_FILE_RETENTION_DAYS = 30;

// ---------------------------------------------------------------- numbers

/**
 * Parses a number as Algerian / French spreadsheets write it: `1 234,50`,
 * `1.234,50`, `1,234.50`, `1234.5`, `1 234 DA`, `-12,5`. Returns null when the
 * text is not a number (never guesses, never goes through a JS float).
 *
 * - every kind of space and a trailing `DA` / `DZD` are ignored;
 * - with both `.` and `,`, the last one is the decimal separator and the other
 *   must group digits by three;
 * - a lone `,` is the decimal separator (French);
 * - several `.` are thousands separators (`1.234.567`); a single `.` is decimal.
 *
 * Numbers read from an Excel cell are JS doubles: they go through
 * `toPrecision(15)` (Excel's own precision), which drops float noise such as
 * `12.300000000000001`.
 */
export function parseImportNumber(raw: string | number | null | undefined): Money | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    return new MoneyDecimal(raw.toPrecision(15));
  }
  let s = raw
    .trim()
    .replace(/\s*(DA|DZD|د\.?ج)\.?$/i, '')
    // \s also matches no-break spaces (U+00A0, U+202F).
    .replace(/\s/g, '');
  if (s === '') return null;
  let sign = '';
  if (s.startsWith('-') || s.startsWith('+')) {
    sign = s.startsWith('-') ? '-' : '';
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let intPart: string;
  let decPart = '';
  let grouping: string | null = null;
  if (lastDot >= 0 && lastComma >= 0) {
    const decimalSep = lastDot > lastComma ? '.' : ',';
    grouping = decimalSep === '.' ? ',' : '.';
    const at = s.lastIndexOf(decimalSep);
    intPart = s.slice(0, at);
    decPart = s.slice(at + 1);
    if (intPart.includes(decimalSep)) return null;
  } else if (lastComma >= 0) {
    if (s.indexOf(',') !== lastComma) return null;
    intPart = s.slice(0, lastComma);
    decPart = s.slice(lastComma + 1);
  } else if (lastDot >= 0 && s.indexOf('.') !== lastDot) {
    grouping = '.';
    intPart = s;
  } else if (lastDot >= 0) {
    intPart = s.slice(0, lastDot);
    decPart = s.slice(lastDot + 1);
  } else {
    intPart = s;
  }

  if (grouping !== null && intPart.includes(grouping)) {
    // 1.234.567 or 1,234: first group 1-3 digits, then groups of exactly 3.
    const groups = intPart.split(grouping);
    if (!/^\d{1,3}$/.test(groups[0] ?? '')) return null;
    if (!groups.slice(1).every((g) => /^\d{3}$/.test(g))) return null;
    intPart = groups.join('');
  }
  if (!/^\d+$/.test(intPart)) return null;
  if (decPart !== '' && !/^\d+$/.test(decPart)) return null;
  if (s.endsWith('.') || s.endsWith(',')) return null;
  return new MoneyDecimal(`${sign}${intPart}${decPart ? `.${decPart}` : ''}`);
}

// ---------------------------------------------------------------- headers

/** Lowercase, no accents, no punctuation, single spaces: `Désignation ` → `designation`. */
export function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export type ImportFieldKind = 'text' | 'money' | 'cost' | 'qty' | 'percent' | 'unit' | 'barcode';

export interface ImportFieldDef {
  /** Stable key used in mappings and row values. */
  key: string;
  kind: ImportFieldKind;
  required: boolean;
  /** Header spellings recognised automatically (normalized on comparison). */
  synonyms: string[];
  /** Human label for price columns (the tenant's level name); other fields are translated by key. */
  label?: string;
}

const f = (
  key: string,
  kind: ImportFieldKind,
  required: boolean,
  synonyms: string[],
): ImportFieldDef => ({ key, kind, required, synonyms });

const PRODUCT_FIELDS: ImportFieldDef[] = [
  f('reference', 'text', true, [
    'reference',
    'ref',
    'code',
    'code article',
    'code produit',
    'المرجع',
    'الرمز',
  ]),
  f('designation', 'text', true, [
    'designation',
    'libelle',
    'nom',
    'article',
    'produit',
    'description',
    'name',
    'التسمية',
    'المنتج',
  ]),
  f('category', 'text', false, ['categorie', 'famille', 'rayon', 'category', 'الفئة', 'العائلة']),
  f('brand', 'text', false, ['marque', 'brand', 'العلامة', 'الماركة']),
  f('baseUnit', 'unit', true, ['unite de base', 'unite', 'u', 'base unit', 'unit', 'الوحدة']),
  f('barcode', 'barcode', false, [
    'code barre',
    'code barres',
    'codebarre',
    'ean',
    'barcode',
    'الباركود',
  ]),
  f('tvaRate', 'percent', false, ['tva', 'taux tva', 'tva %', 'vat', 'الرسم']),
  f('minStock', 'qty', false, ['stock min', 'stock minimum', 'seuil', 'min stock', 'الحد الادنى']),
  f('pack1Unit', 'unit', false, [
    'unite colis 1',
    'colis 1',
    'conditionnement 1',
    'unite colis',
    'colis',
    'conditionnement',
    'pack 1',
  ]),
  f('pack1Factor', 'qty', false, [
    'colisage 1',
    'colisage',
    'facteur 1',
    'facteur colis 1',
    'quantite par colis 1',
    'facteur',
    'qte par colis',
    'quantite par colis',
    'pack 1 factor',
  ]),
  f('pack1Barcode', 'barcode', false, [
    'code barre colis 1',
    'code barres colis 1',
    'code barre colis',
    'ean colis 1',
  ]),
  f('pack2Unit', 'unit', false, ['unite colis 2', 'colis 2', 'conditionnement 2', 'pack 2']),
  f('pack2Factor', 'qty', false, [
    'colisage 2',
    'facteur 2',
    'facteur colis 2',
    'quantite par colis 2',
    'pack 2 factor',
  ]),
  f('pack2Barcode', 'barcode', false, ['code barre colis 2', 'code barres colis 2', 'ean colis 2']),
];

/** Price columns: `price.{position}` for the base unit, `pack1Price.{position}`, `pack2Price.{position}`. */
export const PRICE_FIELD_PREFIXES = ['price', 'pack1Price', 'pack2Price'] as const;

function priceFields(levels: { position: number; name: string }[]): ImportFieldDef[] {
  const out: ImportFieldDef[] = [];
  for (const [i, prefix] of PRICE_FIELD_PREFIXES.entries()) {
    for (const level of levels) {
      const name = normalizeHeader(level.name);
      const pos = String(level.position);
      const synonyms =
        i === 0
          ? [`prix ${name}`, name, `pv ${name}`, `prix ${pos}`, `prix niveau ${pos}`]
          : [`prix ${name} colis ${i}`, `prix colis ${i} ${name}`, `prix ${pos} colis ${i}`];
      out.push({
        key: `${prefix}.${pos}`,
        kind: 'money',
        required: false,
        synonyms,
        label: level.name,
      });
    }
  }
  return out;
}

const OPENING_STOCK_FIELDS: ImportFieldDef[] = [
  f('reference', 'text', true, [
    'reference',
    'ref',
    'code',
    'code article',
    'code produit',
    'المرجع',
  ]),
  f('quantity', 'qty', true, [
    'quantite',
    'qte',
    'qty',
    'stock',
    'stock initial',
    'quantity',
    'الكمية',
  ]),
  f('unit', 'unit', false, ['unite', 'u', 'unit', 'الوحدة']),
  f('unitCost', 'cost', true, [
    'cout unitaire',
    'cout',
    'prix d achat',
    'prix achat',
    'pa',
    'cump',
    'cost',
    'unit cost',
    'التكلفة',
    'سعر الشراء',
  ]),
];

const CLIENT_FIELDS: ImportFieldDef[] = [
  f('code', 'text', true, ['code', 'code client', 'ref', 'reference', 'الرمز']),
  f('name', 'text', true, [
    'nom',
    'nom client',
    'client',
    'raison sociale',
    'name',
    'الاسم',
    'الزبون',
  ]),
  f('phone', 'text', false, ['telephone', 'tel', 'tél', 'mobile', 'portable', 'phone', 'الهاتف']),
  f('address', 'text', false, ['adresse', 'address', 'العنوان']),
  // The owner's own client segments (phase 37), by code or by name.
  f('segment', 'text', false, [
    'type',
    'type client',
    'type de client',
    'canal',
    'segment',
    'categorie client',
    'النوع',
    'نوع الزبون',
  ]),
  f('wilaya', 'text', false, ['wilaya', 'willaya', 'الولاية', 'ولاية']),
  f('commune', 'text', false, ['commune', 'baladia', 'البلدية', 'بلدية']),
  f('creditLimit', 'money', false, [
    'plafond',
    'plafond credit',
    'plafond de credit',
    'limite credit',
    'credit limit',
    'السقف',
  ]),
  f('openingBalance', 'money', false, [
    'solde initial',
    'solde',
    'credit',
    'dette',
    'reste',
    'opening balance',
    'balance',
    'الرصيد',
  ]),
];

const SUPPLIER_FIELDS: ImportFieldDef[] = [
  f('code', 'text', true, ['code', 'code fournisseur', 'ref', 'reference', 'الرمز']),
  f('name', 'text', true, [
    'nom',
    'nom fournisseur',
    'fournisseur',
    'raison sociale',
    'name',
    'supplier',
    'الاسم',
    'المورد',
  ]),
  f('phone', 'text', false, ['telephone', 'tel', 'tél', 'mobile', 'portable', 'phone', 'الهاتف']),
  f('address', 'text', false, ['adresse', 'address', 'العنوان']),
  f('openingBalance', 'money', false, [
    'solde initial',
    'solde',
    'dette',
    'reste',
    'a payer',
    'opening balance',
    'balance',
    'الرصيد',
  ]),
];

/** Personnel (phase 31). Creates employees only: a re-import never doubles a balance. */
const EMPLOYEE_FIELDS: ImportFieldDef[] = [
  f('name', 'text', true, ['nom', 'nom complet', 'employe', 'employé', 'name', 'الاسم']),
  f('hireDate', 'text', true, ['date embauche', "date d'embauche", 'embauche', 'hire date']),
  f('phone', 'text', false, ['telephone', 'tel', 'tél', 'mobile', 'phone', 'الهاتف']),
  f('position', 'text', false, ['poste', 'fonction', 'position', 'المنصب']),
  f('warehouse', 'text', false, ['depot', 'dépôt', 'warehouse', 'المستودع']),
  f('contract', 'text', false, ['contrat', 'type contrat', 'contract', 'العقد']),
  f('contractEndDate', 'text', false, ['fin contrat', 'fin de contrat', 'date fin']),
  f('payType', 'text', false, ['type paie', 'type de paie', 'mode paie', 'pay type']),
  f('salary', 'money', false, ['salaire', 'salaire de base', 'salaire journalier', 'الراتب']),
  f('declared', 'text', false, ['declare', 'déclaré', 'cnas', 'declared']),
  f('nss', 'text', false, ['nss', 'numero securite sociale']),
  f('nin', 'text', false, ['nin', 'numero identification']),
  f('birthDate', 'text', false, ['date naissance', 'date de naissance', 'birth date']),
  f('bankAccount', 'text', false, ['rib', 'ccp', 'rib / ccp', 'compte']),
  f('openingLeave', 'text', false, ['solde conges', 'solde congés', 'conges', 'congés']),
  f('openingAdvance', 'money', false, ['solde avances', 'avances', 'avance']),
];

/** Emballages chez les clients (phase 20): one row per client and packaging type. */
const PACKAGING_OPENING_FIELDS: ImportFieldDef[] = [
  f('clientCode', 'text', true, ['code client', 'code', 'client', 'الرمز', 'الزبون']),
  f('packaging', 'text', true, [
    'emballage',
    'type emballage',
    'casier',
    'packaging',
    'التغليف',
    'العبوة',
  ]),
  f('quantity', 'qty', true, ['quantite', 'qte', 'qty', 'nombre', 'solde', 'quantity', 'الكمية']),
];

/** The fields of an import type. Products need the tenant's active price levels. */
export function importFields(
  type: ImportType,
  priceLevels: { position: number; name: string }[] = [],
): ImportFieldDef[] {
  if (type === ImportType.PRODUCTS) return [...PRODUCT_FIELDS, ...priceFields(priceLevels)];
  if (type === ImportType.OPENING_STOCK) return OPENING_STOCK_FIELDS;
  if (type === ImportType.SUPPLIERS) return SUPPLIER_FIELDS;
  if (type === ImportType.PACKAGING_OPENING) return PACKAGING_OPENING_FIELDS;
  if (type === ImportType.EMPLOYEES) return EMPLOYEE_FIELDS;
  return CLIENT_FIELDS;
}

/** Field key → column index in the file, or null when the column is absent. */
export type ImportMapping = Record<string, number | null>;

/**
 * Guesses which column feeds which field. Exact (normalized) matches win over
 * earlier fields' loose synonyms; each column is used at most once, and the
 * first field listed gets a contested column.
 */
export function detectMapping(headers: string[], fields: ImportFieldDef[]): ImportMapping {
  const normalized = headers.map(normalizeHeader);
  const used = new Set<number>();
  const mapping: ImportMapping = {};
  for (const field of fields) {
    const wanted = new Set(field.synonyms.map(normalizeHeader));
    wanted.add(normalizeHeader(field.key));
    if (field.label) wanted.add(normalizeHeader(field.label));
    const index = normalized.findIndex((h, i) => !used.has(i) && h !== '' && wanted.has(h));
    mapping[field.key] = index >= 0 ? index : null;
    if (index >= 0) used.add(index);
  }
  return mapping;
}

// ---------------------------------------------------------------- units

const UNIT_SYNONYMS: Record<DefaultUnitCode, string[]> = {
  PIECE: ['piece', 'pieces', 'pce', 'pcs', 'pc', 'u', 'unite', 'unit', 'قطعة'],
  KG: ['kg', 'kilo', 'kilogramme', 'kilogrammes', 'كغ'],
  LITRE: ['litre', 'litres', 'l', 'lt', 'لتر'],
  METRE: ['metre', 'metres', 'm', 'ml', 'متر'],
  CARTON: ['carton', 'cartons', 'ctn', 'crt', 'كرتون'],
  FARDEAU: ['fardeau', 'fardeaux', 'fd', 'pack', 'رزمة'],
  SAC: ['sac', 'sacs', 'كيس'],
  BOITE: ['boite', 'boites', 'bte', 'علبة'],
  PAQUET: ['paquet', 'paquets', 'pqt', 'paq', 'باكيت'],
};

/**
 * Finds a unit of the tenant's catalog by what a spreadsheet says (`Pce`, `CTN`,
 * `Carton`, a custom unit's name). Returns the unit id or null.
 */
export function matchUnit(
  text: string,
  units: { id: string; code: string; name: string | null }[],
): string | null {
  const wanted = normalizeHeader(text);
  if (wanted === '') return null;
  for (const u of units) {
    if (u.name && normalizeHeader(u.name) === wanted) return u.id;
    if (normalizeHeader(u.code) === wanted) return u.id;
    const synonyms = UNIT_SYNONYMS[u.code as DefaultUnitCode] as string[] | undefined;
    if (synonyms?.includes(wanted)) return u.id;
  }
  return null;
}

/** Codes of default units, so unknown-unit messages can list what is accepted. */
export const IMPORT_UNIT_CODES = DEFAULT_UNITS.map((u) => u.code);
