import ExcelJS from 'exceljs';
import { ErrorCode, IMPORT_MAX_ROWS } from '@erp/shared';
import { AppException } from '../common/app-exception';

/** A cell as read from the file: text, or a number when Excel stored one. */
export type Cell = string | number | null;

export interface ImportTable {
  headers: string[];
  /** Data rows only; `rowNumber` is the spreadsheet line (header = 1). */
  rows: { rowNumber: number; cells: Cell[] }[];
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function isXlsx(fileName: string, mime: string): boolean {
  return mime === XLSX_MIME || /\.xlsx$/i.test(fileName);
}

export function isCsv(fileName: string, mime: string): boolean {
  return /\.csv$/i.test(fileName) || mime === 'text/csv' || mime === 'application/csv';
}

function invalid(reason: string): AppException {
  return new AppException(ErrorCode.IMPORT_FILE_INVALID, 'Unreadable import file', { reason });
}

/** Reads the first worksheet of an .xlsx file, or a .csv file. */
export async function readTable(
  data: Buffer,
  fileName: string,
  mime: string,
): Promise<ImportTable> {
  if (isXlsx(fileName, mime)) return toTable(await readXlsx(data));
  if (isCsv(fileName, mime)) return toTable(parseCsv(decodeText(data)));
  throw invalid('unsupported_format');
}

/** First non-empty row is the header; fully empty rows are skipped. */
function toTable(lines: { rowNumber: number; cells: Cell[] }[]): ImportTable {
  const nonEmpty = lines.filter((l) => l.cells.some((c) => c !== null && String(c).trim() !== ''));
  const [header, ...rows] = nonEmpty;
  if (!header) throw invalid('empty_file');
  if (rows.length > IMPORT_MAX_ROWS) {
    throw new AppException(ErrorCode.IMPORT_TOO_MANY_ROWS, 'Too many rows', {
      max: IMPORT_MAX_ROWS,
      rows: rows.length,
    });
  }
  return {
    headers: header.cells.map((c) => (c === null ? '' : String(c).trim())),
    rows,
  };
}

// ---------------------------------------------------------------- xlsx

async function readXlsx(data: Buffer): Promise<{ rowNumber: number; cells: Cell[] }[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs types expect the older Buffer type; the runtime accepts any Buffer.
    await workbook.xlsx.load(data as unknown as ExcelJS.Buffer);
  } catch {
    throw invalid('corrupt_xlsx');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw invalid('empty_file');
  const out: { rowNumber: number; cells: Cell[] }[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: Cell[] = [];
    for (let col = 1; col <= row.cellCount; col++) cells.push(cellValue(row.getCell(col).value));
    out.push({ rowNumber, cells });
  });
  return out;
}

function cellValue(value: ExcelJS.CellValue): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if ('richText' in value) return value.richText.map((r) => r.text).join('');
  if ('error' in value) return null;
  if ('result' in value) {
    // Formula: use the value Excel computed and saved.
    const result = value.result;
    if (result === undefined || result === null) return null;
    return cellValue(result);
  }
  if ('text' in value) {
    const text = (value as { text: unknown }).text;
    if (typeof text === 'string') return text;
    if (text && typeof text === 'object' && 'richText' in text) {
      return (text as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('');
    }
  }
  return null;
}

// ---------------------------------------------------------------- csv

/**
 * UTF-8 when the bytes are valid UTF-8 (BOM dropped), otherwise Windows-1252,
 * which is what French Excel writes for "CSV (séparateur: point-virgule)".
 */
export function decodeText(data: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(data);
  } catch {
    return new TextDecoder('windows-1252').decode(data);
  }
}

/**
 * RFC 4180 parser: quoted fields, doubled quotes, newlines inside quotes, CRLF.
 * The delimiter is `;` or `,` (or tab), whichever appears most in the first line
 * outside quotes. Cells stay text: numbers are parsed later with French rules.
 */
export function parseCsv(text: string): { rowNumber: number; cells: Cell[] }[] {
  const delimiter = detectDelimiter(text);
  const rows: { rowNumber: number; cells: Cell[] }[] = [];
  let cells: Cell[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let rowStart = 1;
  const pushField = () => {
    cells.push(field === '' ? null : field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push({ rowNumber: rowStart, cells });
    cells = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') inQuotes = true;
    else if (ch === delimiter) pushField();
    else if (ch === '\r') continue;
    else if (ch === '\n') {
      pushRow();
      line++;
      rowStart = line;
    } else field += ch;
  }
  if (inQuotes) throw invalid('unclosed_quote');
  if (field !== '' || cells.length > 0) pushRow();
  return rows;
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const outside = firstLine.replace(/"[^"]*"/g, '');
  const counts = [';', ',', '\t'].map((d) => ({ d, n: outside.split(d).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0] && counts[0].n > 0 ? counts[0].d : ';';
}
