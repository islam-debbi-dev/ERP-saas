import { promisify } from 'node:util';
import { inflateRaw } from 'node:zlib';
import { ErrorCode, IMPORT_MAX_ROWS } from '@erp/shared';
import { AppException } from '../common/app-exception';

/**
 * Audit 02, B-1: an .xlsx is a zip, and the 10 MB limit of the upload is on the zipped
 * file. One megabyte can inflate to hundreds, and exceljs builds the whole workbook in
 * memory before a single row can be counted: a crafted file took the process down.
 *
 * So the file is measured here, before exceljs sees it: its entries are inflated one by
 * one under a byte budget (the real bytes, not the sizes the zip declares, which a crafted
 * file can lie about), and the rows and cells of its sheets are counted in the raw XML.
 * exceljs parses every sheet of a workbook, so the limits are on all of them together.
 */
export const XLSX_LIMITS = {
  /** A workbook written by Excel has a few dozen parts. */
  entries: 500,
  /** All parts together, inflated. A full import (10 000 rows) is a few MB. */
  inflatedBytes: 50 * 1024 * 1024,
  sheets: 10,
  /** `<row>` elements, empty ones included: twice the rows an import may hold. */
  rows: IMPORT_MAX_ROWS * 2,
  cells: 400_000,
} as const;

const inflate = promisify(inflateRaw);

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const SHEET = /^xl\/worksheets\/[^/]+\.xml$/i;

function invalid(reason: string, details: Record<string, unknown> = {}): AppException {
  return new AppException(ErrorCode.IMPORT_FILE_INVALID, 'Unreadable import file', {
    reason,
    ...details,
  });
}

/** Too big for an import: the answer the user already knows ("split the file"), 400. */
function tooBig(rule: 'entries' | 'inflated_bytes' | 'rows' | 'cells'): AppException {
  return new AppException(ErrorCode.IMPORT_TOO_MANY_ROWS, 'Too many rows', {
    max: IMPORT_MAX_ROWS,
    rule,
  });
}

interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflate. */
  method: number;
  compressedSize: number;
  localOffset: number;
}

/** The central directory, read the way exceljs's unzipper reads it: from the last EOCD. */
function entriesOf(data: Buffer): ZipEntry[] {
  let eocd = -1;
  // The record is 22 bytes plus a comment of at most 65 535.
  for (let i = data.length - 22, min = Math.max(0, data.length - 22 - 0xffff); i >= min; i--) {
    if (data.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw invalid('corrupt_xlsx');
  const count = data.readUInt16LE(eocd + 10);
  let p = data.readUInt32LE(eocd + 16);
  // Zip64 is for archives over 4 GB or 65 535 entries: never an upload of 10 MB.
  if (count === 0xffff || p === 0xffffffff) throw invalid('corrupt_xlsx');
  if (count > XLSX_LIMITS.entries) throw tooBig('entries');
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > data.length || data.readUInt32LE(p) !== CENTRAL) throw invalid('corrupt_xlsx');
    const nameLength = data.readUInt16LE(p + 28);
    out.push({
      name: data.toString('utf8', p + 46, p + 46 + nameLength),
      method: data.readUInt16LE(p + 10),
      compressedSize: data.readUInt32LE(p + 20),
      localOffset: data.readUInt32LE(p + 42),
    });
    p += 46 + nameLength + data.readUInt16LE(p + 30) + data.readUInt16LE(p + 32);
  }
  return out;
}

/** The inflated bytes of one entry, never more than `budget` of them. */
async function contentOf(data: Buffer, entry: ZipEntry, budget: number): Promise<Buffer> {
  const h = entry.localOffset;
  if (h + 30 > data.length || data.readUInt32LE(h) !== LOCAL) throw invalid('corrupt_xlsx');
  const start = h + 30 + data.readUInt16LE(h + 26) + data.readUInt16LE(h + 28);
  const end = start + entry.compressedSize;
  if (end > data.length) throw invalid('corrupt_xlsx');
  const raw = data.subarray(start, end);
  if (entry.method === 0) {
    if (raw.length > budget) throw tooBig('inflated_bytes');
    return raw;
  }
  if (entry.method !== 8) throw invalid('corrupt_xlsx');
  try {
    // zlib stops as soon as the output passes the limit: the bomb is never held in memory.
    return await inflate(raw, { maxOutputLength: Math.max(1, budget) });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
      throw tooBig('inflated_bytes');
    }
    throw invalid('corrupt_xlsx');
  }
}

const isTagEnd = (byte: number | undefined): boolean =>
  byte === 0x20 ||
  byte === 0x3e ||
  byte === 0x2f ||
  byte === 0x09 ||
  byte === 0x0a ||
  byte === 0x0d;

/** `<row …>` and `<c …>` elements of a sheet, counted on the bytes (no string is built). */
export function countRowsAndCells(xml: Buffer): { rows: number; cells: number } {
  let rows = 0;
  let cells = 0;
  for (let i = xml.indexOf(0x3c); i !== -1; i = xml.indexOf(0x3c, i + 1)) {
    const next = xml[i + 1];
    if (next === 0x63 /* c */) {
      if (isTagEnd(xml[i + 2])) cells += 1;
    } else if (
      next === 0x72 /* r */ &&
      xml[i + 2] === 0x6f /* o */ &&
      xml[i + 3] === 0x77 /* w */ &&
      isTagEnd(xml[i + 4])
    ) {
      rows += 1;
    }
  }
  return { rows, cells };
}

/**
 * Refuses (400) a workbook that is too big to be parsed safely: too many parts, too many
 * bytes once inflated, too many sheets, rows or cells. Returns for any file exceljs can
 * be given; whether it is a real workbook is exceljs's answer.
 */
export async function assertXlsxWithinLimits(data: Buffer): Promise<void> {
  const entries = entriesOf(data);
  const sheets = entries.filter((e) => SHEET.test(e.name));
  if (sheets.length > XLSX_LIMITS.sheets) {
    throw invalid('too_many_sheets', { max: XLSX_LIMITS.sheets, sheets: sheets.length });
  }
  let budget: number = XLSX_LIMITS.inflatedBytes;
  let rows = 0;
  let cells = 0;
  for (const entry of entries) {
    const content = await contentOf(data, entry, budget);
    budget -= content.length;
    if (!SHEET.test(entry.name)) continue;
    const counted = countRowsAndCells(content);
    rows += counted.rows;
    cells += counted.cells;
    if (rows > XLSX_LIMITS.rows) throw tooBig('rows');
    if (cells > XLSX_LIMITS.cells) throw tooBig('cells');
  }
}
