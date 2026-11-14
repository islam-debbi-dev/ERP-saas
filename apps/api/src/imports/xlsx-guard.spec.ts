import ExcelJS from 'exceljs';
import { ErrorCode, IMPORT_MAX_FILE_BYTES } from '@erp/shared';
import { numberedSheet, sheetOf, workbookOf, xlsxBomb, zipOf } from '../../test/xlsx-fixture';
import { AppException } from '../common/app-exception';
import { readTable } from './file-reader';
import { assertXlsxWithinLimits, countRowsAndCells, XLSX_LIMITS } from './xlsx-guard';

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const refusal = async (
  file: Buffer,
): Promise<{ status: number; code: string; details: unknown }> => {
  try {
    await assertXlsxWithinLimits(file);
  } catch (err) {
    if (!(err instanceof AppException)) throw err;
    const body = err.getResponse() as { code: string; details?: unknown };
    return { status: err.getStatus(), code: body.code, details: body.details };
  }
  throw new Error('the file was accepted');
};

describe('xlsx limits before parsing (audit 02, B-1)', () => {
  it('a workbook written by exceljs, and one written by the fixture, pass and are read', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Clients');
    ws.addRow(['Code', 'Nom']);
    for (let i = 1; i <= 500; i++) ws.addRow([`C${i}`, `Client ${i}`]);
    const real = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(assertXlsxWithinLimits(real)).resolves.toBeUndefined();
    expect((await readTable(real, 'clients.xlsx', MIME)).rows).toHaveLength(500);

    // The fixture's zip is a workbook exceljs opens: the bomb below is a real file.
    const handMade = workbookOf([
      numberedSheet([
        ['Code', 'Nom'],
        ['C1', 'Ali'],
        ['C2', 'Omar'],
      ]),
    ]);
    const table = await readTable(handMade, 'clients.xlsx', MIME);
    expect(table.headers).toEqual(['Code', 'Nom']);
    expect(table.rows.map((r) => r.cells)).toEqual([
      ['C1', 'Ali'],
      ['C2', 'Omar'],
    ]);
  });

  it('the 1 MB file that inflates to 250 MB is refused with 400, without being inflated', async () => {
    const bomb = xlsxBomb();
    expect(bomb.length).toBeLessThan(IMPORT_MAX_FILE_BYTES);
    expect(bomb.length).toBeLessThan(1.5 * 1024 * 1024);
    const before = process.memoryUsage().rss;
    const started = Date.now();
    await expect(readTable(bomb, 'bomb.xlsx', MIME)).rejects.toMatchObject({
      status: 400,
      response: { code: ErrorCode.IMPORT_TOO_MANY_ROWS, details: { rule: 'inflated_bytes' } },
    });
    expect(Date.now() - started).toBeLessThan(3000);
    // The whole sheet is 250 MB; the budget stops the inflate at 50.
    expect(process.memoryUsage().rss - before).toBeLessThan(150 * 1024 * 1024);
  });

  it('the bytes are counted over every part, not per part', async () => {
    const part = Buffer.alloc(20 * 1024 * 1024, 'a');
    const file = zipOf({ 'xl/a.xml': part, 'xl/b.xml': part, 'xl/c.xml': part });
    expect(await refusal(file)).toMatchObject({
      status: 400,
      code: ErrorCode.IMPORT_TOO_MANY_ROWS,
      details: { rule: 'inflated_bytes' },
    });
  });

  it('too many rows, cells or sheets are refused with 400, counted over all sheets', async () => {
    const half = sheetOf(XLSX_LIMITS.rows / 2 + 1, 1, 'x');
    expect(await refusal(workbookOf([half, half]))).toMatchObject({
      status: 400,
      code: ErrorCode.IMPORT_TOO_MANY_ROWS,
      details: { rule: 'rows' },
    });
    const wide = sheetOf(100, XLSX_LIMITS.cells / 100 + 1, 'x');
    expect(await refusal(workbookOf([wide]))).toMatchObject({
      status: 400,
      code: ErrorCode.IMPORT_TOO_MANY_ROWS,
      details: { rule: 'cells' },
    });
    const many = Array.from({ length: XLSX_LIMITS.sheets + 1 }, () => sheetOf(1, 1, 'x'));
    expect(await refusal(workbookOf(many))).toMatchObject({
      status: 400,
      code: ErrorCode.IMPORT_FILE_INVALID,
      details: { reason: 'too_many_sheets' },
    });
    // At the limits: accepted.
    await expect(
      assertXlsxWithinLimits(workbookOf([sheetOf(XLSX_LIMITS.rows, 1, 'x')])),
    ).resolves.toBeUndefined();
  });

  it('a file that is not a zip, or a truncated one, is an unreadable file (400)', async () => {
    const good = workbookOf([sheetOf(2, 1, 'x')]);
    for (const file of [
      Buffer.from('MZ not a zip at all'),
      Buffer.alloc(0),
      good.subarray(0, good.length - 30),
      Buffer.concat([Buffer.alloc(64, 7), good.subarray(good.length - 22)]),
    ]) {
      expect(await refusal(file)).toMatchObject({
        status: 400,
        code: ErrorCode.IMPORT_FILE_INVALID,
        details: { reason: 'corrupt_xlsx' },
      });
    }
  });

  it('counts <row> and <c> elements only', () => {
    const xml = Buffer.from(
      '<worksheet><cols><col min="1"/></cols><sheetData><row r="1"><c r="A1"><v>1</v></c><c/></row><row/>' +
        '<rowBreaks/><customPr/></sheetData></worksheet>',
    );
    expect(countRowsAndCells(xml)).toEqual({ rows: 2, cells: 2 });
  });
});
