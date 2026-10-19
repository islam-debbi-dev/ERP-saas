import ExcelJS from 'exceljs';
import { detectMapping, ErrorCode, importFields, IMPORT_TYPES } from '@erp/shared';
import { AppException } from '../common/app-exception';
import { decodeText, parseCsv, readTable } from './file-reader';
import { buildTemplate, templateHeader } from './templates';

const LEVELS = [
  { position: 1, name: 'Gros' },
  { position: 2, name: 'Demi-gros' },
  { position: 3, name: 'Détail' },
];

describe('parseCsv', () => {
  it('detects the semicolon of French Excel and keeps cells as text', () => {
    const rows = parseCsv('Code;Nom;Solde initial\r\nC1;Ali;1 234,50\r\n');
    expect(rows).toEqual([
      { rowNumber: 1, cells: ['Code', 'Nom', 'Solde initial'] },
      { rowNumber: 2, cells: ['C1', 'Ali', '1 234,50'] },
    ]);
  });

  it('reads commas, quoted fields, doubled quotes and newlines inside quotes', () => {
    const rows = parseCsv('a,b,c\n"x, y","say ""hi""","line1\nline2"\n4,,6');
    expect(rows[1]?.cells).toEqual(['x, y', 'say "hi"', 'line1\nline2']);
    expect(rows[2]).toEqual({ rowNumber: 4, cells: ['4', null, '6'] });
  });

  it('refuses an unclosed quote', () => {
    expect(() => parseCsv('a;b\n"open;2')).toThrow(AppException);
  });
});

describe('decodeText', () => {
  it('drops the UTF-8 BOM', () => {
    const text = decodeText(Buffer.from('﻿Désignation;Prix', 'utf8'));
    expect(text).toBe('Désignation;Prix');
  });

  it('falls back to Windows-1252 for French Excel CSV files', () => {
    // "Désignation" in cp1252: é = 0xE9 (invalid as UTF-8 here)
    const bytes = Buffer.from([0x44, 0xe9, 0x73, 0x69, 0x67, 0x6e, 0x61, 0x74, 0x69, 0x6f, 0x6e]);
    expect(decodeText(bytes)).toBe('Désignation');
  });
});

describe('readTable', () => {
  it('reads numbers, formulas and rich text from xlsx and skips empty rows', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    ws.addRow(['Référence', 'Prix', 'Total']);
    ws.addRow([]);
    ws.addRow(['A-1', 12.3, { formula: 'B3*2', result: 24.6 }]);
    ws.addRow([{ richText: [{ text: 'B-' }, { text: '2' }] }, '1 500,00', null]);
    const data = Buffer.from(await wb.xlsx.writeBuffer());
    const table = await readTable(data, 'f.xlsx', 'application/octet-stream');
    expect(table.headers).toEqual(['Référence', 'Prix', 'Total']);
    expect(table.rows).toEqual([
      { rowNumber: 3, cells: ['A-1', 12.3, 24.6] },
      { rowNumber: 4, cells: ['B-2', '1 500,00'] },
    ]);
  });

  it('refuses other formats and corrupt files', async () => {
    const fail = (p: Promise<unknown>) =>
      p.then(
        () => null,
        (e: AppException) => (e.getResponse() as { code: string }).code,
      );
    expect(await fail(readTable(Buffer.from('x'), 'f.pdf', 'application/pdf'))).toBe(
      ErrorCode.IMPORT_FILE_INVALID,
    );
    expect(await fail(readTable(Buffer.from('not a zip'), 'f.xlsx', ''))).toBe(
      ErrorCode.IMPORT_FILE_INVALID,
    );
    expect(await fail(readTable(Buffer.from(''), 'f.csv', 'text/csv'))).toBe(
      ErrorCode.IMPORT_FILE_INVALID,
    );
  });
});

describe('templates', () => {
  it.each(IMPORT_TYPES)('the %s template headers map back to every field', async (type) => {
    const fields = importFields(type, LEVELS);
    const table = await readTable(await buildTemplate(type, LEVELS), 't.xlsx', '');
    expect(table.headers).toEqual(fields.map(templateHeader));
    const mapping = detectMapping(table.headers, fields);
    fields.forEach((f, i) => expect([f.key, mapping[f.key]]).toEqual([f.key, i]));
    expect(table.rows).toHaveLength(2);
  });
});
