import ExcelJS from 'exceljs';
import { type ImportFieldDef, importFields, ImportType } from '@erp/shared';

/** French column titles written in the templates; `detectMapping` reads them back. */
const HEADERS: Record<string, string> = {
  reference: 'Référence',
  designation: 'Désignation',
  category: 'Catégorie',
  baseUnit: 'Unité de base',
  barcode: 'Code-barres',
  tvaRate: 'TVA %',
  minStock: 'Stock min',
  pack1Unit: 'Colis 1',
  pack1Factor: 'Colisage 1',
  pack1Barcode: 'Code-barres colis 1',
  pack2Unit: 'Colis 2',
  pack2Factor: 'Colisage 2',
  pack2Barcode: 'Code-barres colis 2',
  quantity: 'Quantité',
  unit: 'Unité',
  unitCost: 'Coût unitaire',
  code: 'Code',
  name: 'Nom',
  phone: 'Téléphone',
  address: 'Adresse',
  creditLimit: 'Plafond',
  openingBalance: 'Solde initial',
};

export function templateHeader(field: ImportFieldDef): string {
  const [prefix, position] = field.key.split('.');
  if (position !== undefined) {
    const level = field.label ?? `Niveau ${position}`;
    if (prefix === 'price') return `Prix ${level}`;
    return `Prix ${level} colis ${prefix === 'pack1Price' ? 1 : 2}`;
  }
  return HEADERS[field.key] ?? field.key;
}

/** Two example rows per type, keyed by field (price keys use level positions 1..3). */
const EXAMPLES: Record<ImportType, Record<string, string | number>[]> = {
  PRODUCTS: [
    {
      reference: 'HUI-5L',
      designation: 'Huile de table 5 L',
      category: 'Alimentation',
      baseUnit: 'Pièce',
      barcode: '6130000000017',
      tvaRate: 9,
      minStock: 24,
      pack1Unit: 'Carton',
      pack1Factor: 4,
      'price.1': '1 150,00',
      'price.2': '1 180,00',
      'price.3': '1 250,00',
      'pack1Price.1': '4 560,00',
    },
    {
      reference: 'SUC-1KG',
      designation: 'Sucre blanc 1 kg',
      category: 'Alimentation',
      baseUnit: 'Pièce',
      tvaRate: 0,
      pack1Unit: 'Fardeau',
      pack1Factor: 10,
      'price.1': '95,00',
      'price.2': '100,00',
      'price.3': '110,00',
    },
  ],
  OPENING_STOCK: [
    { reference: 'HUI-5L', quantity: 40, unit: 'Carton', unitCost: '4 400,00' },
    { reference: 'SUC-1KG', quantity: 250, unit: 'Pièce', unitCost: '88,50' },
  ],
  CLIENTS: [
    {
      code: 'C001',
      name: 'Épicerie El Baraka',
      phone: '0550 12 34 56',
      address: 'Cité 200 logements, Sétif',
      creditLimit: '200 000,00',
      openingBalance: '45 300,00',
    },
    { code: 'C002', name: 'Superette Nour', phone: '0661 98 76 54', openingBalance: '-2 000,00' },
  ],
  SUPPLIERS: [
    {
      code: 'F001',
      name: 'Sarl Distribution Atlas',
      phone: '0770 11 22 33',
      address: 'Zone industrielle, Rouiba',
      openingBalance: '320 000,00',
    },
    { code: 'F002', name: 'Ets Benali Frères', phone: '0555 44 33 22', openingBalance: '-15 000,00' },
  ],
};

export async function buildTemplate(
  type: ImportType,
  priceLevels: { position: number; name: string }[],
): Promise<Buffer> {
  const fields = importFields(type, priceLevels);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Import');
  sheet.addRow(fields.map(templateHeader));
  for (const example of EXAMPLES[type]) sheet.addRow(fields.map((f) => example[f.key] ?? null));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  fields.forEach((f, i) => {
    const column = sheet.getColumn(i + 1);
    column.width = Math.max(12, templateHeader(f).length + 4);
    // Text cells keep leading zeros of references, codes and barcodes.
    if (f.kind === 'text' || f.kind === 'barcode') column.numFmt = '@';
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export const TEMPLATE_FILE_NAMES: Record<ImportType, string> = {
  [ImportType.PRODUCTS]: 'modele-import-produits.xlsx',
  [ImportType.OPENING_STOCK]: 'modele-import-stock-initial.xlsx',
  [ImportType.CLIENTS]: 'modele-import-clients.xlsx',
  [ImportType.SUPPLIERS]: 'modele-import-fournisseurs.xlsx',
};
