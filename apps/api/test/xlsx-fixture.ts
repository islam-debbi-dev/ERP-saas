import { crc32, deflateRawSync } from 'node:zlib';

/**
 * Hand-made .xlsx files for the import limits (audit 02, B-1): a zip written here, so a
 * test can make a sheet no spreadsheet program would save: millions of rows in 1 MB.
 */

/** A zip archive (deflate) of the given files, in order. */
export function zipOf(files: Record<string, Buffer | string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const packed = deflateRawSync(data, { level: 9 });
    const nameBytes = Buffer.from(name, 'utf8');
    const sum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(8, 10);
    header.writeUInt32LE(sum, 16);
    header.writeUInt32LE(packed.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    central.push(header, nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const NS = 'http://schemas.openxmlformats.org';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/**
 * A worksheet of `rows` rows, each of `cellsPerRow` identical text cells. The rows carry no
 * number (they are one pattern repeated): good for the limits, not for exceljs to read.
 */
export function sheetOf(
  rows: number,
  cellsPerRow = 1,
  text = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
): Buffer {
  const row = Buffer.from(
    `<row>${`<c t="inlineStr"><is><t>${text}</t></is></c>`.repeat(cellsPerRow)}</row>`,
  );
  return Buffer.concat([
    Buffer.from(`${HEAD}<worksheet xmlns="${NS}/spreadsheetml/2006/main"><sheetData>`),
    // Filled with the row, repeated: no string of hundreds of MB is built.
    Buffer.alloc(row.length * rows, row),
    Buffer.from('</sheetData></worksheet>'),
  ]);
}

/** A small sheet as Excel writes one, rows and cells numbered: exceljs reads it. */
export function numberedSheet(rows: string[][]): Buffer {
  const body = rows
    .map(
      (cells, r) =>
        `<row r="${r + 1}">${cells
          .map(
            (text, c) =>
              `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${text}</t></is></c>`,
          )
          .join('')}</row>`,
    )
    .join('');
  return Buffer.from(
    `${HEAD}<worksheet xmlns="${NS}/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`,
  );
}

/** A workbook exceljs opens, with the given sheets (raw XML). */
export function workbookOf(sheets: Buffer[]): Buffer {
  const ids = sheets.map((_, i) => i + 1);
  return zipOf({
    '[Content_Types].xml':
      `${HEAD}<Types xmlns="${NS}/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      ids
        .map(
          (i) =>
            `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join('') +
      '</Types>',
    '_rels/.rels':
      `${HEAD}<Relationships xmlns="${NS}/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      '</Relationships>',
    'xl/workbook.xml':
      `${HEAD}<workbook xmlns="${NS}/spreadsheetml/2006/main" xmlns:r="${NS}/officeDocument/2006/relationships"><sheets>` +
      ids.map((i) => `<sheet name="Feuille${i}" sheetId="${i}" r:id="rId${i}"/>`).join('') +
      '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      `${HEAD}<Relationships xmlns="${NS}/package/2006/relationships">` +
      ids
        .map(
          (i) =>
            `<Relationship Id="rId${i}" Type="${NS}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`,
        )
        .join('') +
      '</Relationships>',
    ...Object.fromEntries(sheets.map((xml, i) => [`xl/worksheets/sheet${i + 1}.xml`, xml])),
  });
}

/**
 * The file of REPORT-02, B-1: one sheet of 4 000 000 one-cell rows, about 250 MB of XML
 * in about 1 MB of zip, far under the 10 MB limit of the upload.
 */
export function xlsxBomb(rows = 4_000_000): Buffer {
  return workbookOf([sheetOf(rows)]);
}
