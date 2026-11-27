import { describe, expect, it } from 'vitest';
import {
  detectMapping,
  importFields,
  ImportType,
  matchUnit,
  normalizeHeader,
  parseImportNumber,
} from './imports';

const parse = (v: string | number) => parseImportNumber(v)?.toString() ?? null;

describe('parseImportNumber', () => {
  it.each([
    ['1 234,50', '1234.5'],
    ['1.234,50', '1234.5'],
    ['1,234.50', '1234.5'],
    ['1234.5', '1234.5'],
    ['1 234 DA', '1234'],
    ['1 234,5 DA', '1234.5'],
    ['12 500,00 DZD', '12500'],
    ['1.234.567', '1234567'],
    ['1.234.567,89', '1234567.89'],
    ['-2 000', '-2000'],
    ['-12,5', '-12.5'],
    ['+15', '15'],
    ['0', '0'],
    ['1,234', '1.234'],
    ['  42  ', '42'],
  ])('reads %j as %s', (input, expected) => {
    expect(parse(input)).toBe(expected);
  });

  it('reads Excel numeric cells without float noise', () => {
    expect(parse(12.300000000000001)).toBe('12.3');
    expect(parse(0.1 + 0.2)).toBe('0.3');
    expect(parse(1500)).toBe('1500');
    expect(parse(Number.NaN)).toBeNull();
  });

  it.each([
    '',
    '   ',
    'DA',
    '1,2,3',
    '12a',
    '1.23.4',
    'abc',
    '1.234,5,6',
    '1,23.456,7',
    '12,',
    '.',
    '--5',
    '1 234,50 EUR',
    '1,23,456.5',
  ])('refuses %j', (input) => {
    expect(parse(input)).toBeNull();
  });

  it('returns null for null and undefined', () => {
    expect(parseImportNumber(null)).toBeNull();
    expect(parseImportNumber(undefined)).toBeNull();
  });
});

describe('normalizeHeader', () => {
  it('drops accents, case and punctuation', () => {
    expect(normalizeHeader('  Désignation ')).toBe('designation');
    expect(normalizeHeader('Coût unitaire (DA)')).toBe('cout unitaire da');
    expect(normalizeHeader("Prix d'achat")).toBe('prix d achat');
    expect(normalizeHeader('الرصيد')).toBe('الرصيد');
  });
});

describe('detectMapping', () => {
  it('maps French headers to client fields', () => {
    const headers = ['Code client', 'Nom', 'Tél', 'Adresse', 'Plafond crédit', 'Solde initial'];
    expect(detectMapping(headers, importFields(ImportType.CLIENTS))).toEqual({
      code: 0,
      name: 1,
      phone: 2,
      address: 3,
      wilaya: null,
      commune: null,
      segment: null,
      creditLimit: 4,
      openingBalance: 5,
    });
  });

  it('maps the wilaya and commune headers in French and Arabic (phase 40a)', () => {
    const fields = importFields(ImportType.CLIENTS);
    expect(detectMapping(['Code', 'Nom', 'Wilaya', 'Commune'], fields)).toMatchObject({
      wilaya: 2,
      commune: 3,
    });
    expect(detectMapping(['الرمز', 'الاسم', 'الولاية', 'البلدية'], fields)).toMatchObject({
      wilaya: 2,
      commune: 3,
    });
  });

  it('maps a "Type client" header to the client segment (phase 37)', () => {
    const mapping = detectMapping(['Code', 'Nom', 'Type client'], importFields(ImportType.CLIENTS));
    expect(mapping['segment']).toBe(2);
  });

  it('accepts Arabic and English headers and leaves unknown columns unmapped', () => {
    const headers = ['المرجع', 'Quantity', 'Remarque', 'Unit cost'];
    expect(detectMapping(headers, importFields(ImportType.OPENING_STOCK))).toEqual({
      reference: 0,
      quantity: 1,
      unit: null,
      unitCost: 3,
    });
  });

  it('uses each column once, even when headers repeat', () => {
    const mapping = detectMapping(['Code', 'Code', 'Nom'], importFields(ImportType.CLIENTS));
    expect(mapping['code']).toBe(0);
    expect(mapping['name']).toBe(2);
  });

  it('matches price columns by the tenant level names', () => {
    const fields = importFields(ImportType.PRODUCTS, [
      { position: 1, name: 'Gros' },
      { position: 2, name: 'Demi-gros' },
    ]);
    const headers = [
      'Référence',
      'Désignation',
      'Unité',
      'Colisage',
      'Prix Gros',
      'Prix demi gros',
      'Prix gros colis 1',
    ];
    const mapping = detectMapping(headers, fields);
    expect(mapping).toMatchObject({
      reference: 0,
      designation: 1,
      baseUnit: 2,
      pack1Factor: 3,
      'price.1': 4,
      'price.2': 5,
      'pack1Price.1': 6,
      category: null,
    });
  });
});

describe('matchUnit', () => {
  const units = [
    { id: 'p', code: 'PIECE', name: null },
    { id: 'c', code: 'CARTON', name: null },
    { id: 'x', code: 'CUSTOM-1', name: 'Palette' },
  ];
  it.each([
    ['Pièce', 'p'],
    ['pce', 'p'],
    ['CTN', 'c'],
    ['Carton', 'c'],
    ['palette', 'x'],
    ['kg', null],
    ['', null],
  ])('%j → %s', (text, id) => {
    expect(matchUnit(text, units)).toBe(id);
  });
});
