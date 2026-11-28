/**
 * A CSV a spreadsheet can open safely: UTF-8 with a BOM (Arabic names), `;` as French
 * Excel expects, every cell quoted, and no cell a spreadsheet would run as a formula (the
 * text comes from what people typed on client files).
 */
export const CSV_BOM = '﻿';

export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value);
  // = + - @ start a formula, also behind blanks; a leading tab or return is unsafe too.
  // The full-width forms count in some spreadsheets.
  if (/^[\t\r\n]|^\s*[=+\-@＝＋－＠]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function csvLine(cells: readonly (string | number | null | undefined)[]): string {
  return `${cells.map(csvCell).join(';')}\r\n`;
}
