import {
  type ImportFieldDef,
  type ImportIssue,
  type ImportMapping,
  type ImportRowAction,
  type ImportRowDto,
  parseImportNumber,
} from '@erp/shared';
import type { Cell } from '../file-reader';

/** Display text of a cell: numbers without float noise, text trimmed. */
export function cellText(cell: Cell | undefined): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'number') return parseImportNumber(cell)?.toString() ?? '';
  return cell.trim();
}

export interface NumberRule {
  decimals: number;
  /** Allows negative values (solde initial). */
  signed?: boolean;
  /** Refuses zero. */
  positive?: boolean;
  /** Upper bound included (TVA ≤ 100). */
  max?: string;
}

/**
 * One spreadsheet row being validated: reads mapped cells and collects issues.
 * Validators never throw for bad data; they report it on the row.
 */
export class RowReader {
  readonly errors: ImportIssue[] = [];
  readonly warnings: ImportIssue[] = [];
  readonly values: Record<string, string> = {};

  constructor(
    readonly rowNumber: number,
    private readonly cells: Cell[],
    private readonly mapping: ImportMapping,
    fields: ImportFieldDef[],
  ) {
    for (const f of fields) {
      const text = this.text(f.key);
      if (text !== '') this.values[f.key] = text;
    }
  }

  private cell(key: string): Cell | undefined {
    const index = this.mapping[key];
    return index === null || index === undefined ? undefined : this.cells[index];
  }

  text(key: string): string {
    return cellText(this.cell(key));
  }

  error(field: string | undefined, code: string, params?: Record<string, string>): void {
    this.errors.push({ ...(field ? { field } : {}), code, ...(params ? { params } : {}) });
  }

  warn(field: string | undefined, code: string, params?: Record<string, string>): void {
    this.warnings.push({ ...(field ? { field } : {}), code, ...(params ? { params } : {}) });
  }

  /** Text that must be present and at most `max` characters; null (and an error) otherwise. */
  requiredText(key: string, max: number): string | null {
    const v = this.text(key);
    if (v === '') {
      this.error(key, 'required');
      return null;
    }
    return this.maxLength(key, v, max);
  }

  /** Optional text: '' when absent, null (and an error) when too long. */
  optionalText(key: string, max: number): string | null {
    return this.maxLength(key, this.text(key), max);
  }

  private maxLength(key: string, v: string, max: number): string | null {
    if (v.length > max) {
      this.error(key, 'too_long', { max: String(max) });
      return null;
    }
    return v;
  }

  /**
   * Parses a number with the French/Algerian rules. Returns the canonical string,
   * `''` when the cell is empty, or null (and an error) when invalid.
   */
  number(key: string, rule: NumberRule): string | null {
    const cell = this.cell(key);
    if (cell === undefined || cell === null || (typeof cell === 'string' && cell.trim() === '')) {
      return '';
    }
    const parsed = parseImportNumber(cell);
    if (parsed === null) {
      this.error(key, 'invalid_number', { value: cellText(cell) });
      return null;
    }
    if (parsed.decimalPlaces() > rule.decimals) {
      this.error(key, 'too_many_decimals', { max: String(rule.decimals) });
      return null;
    }
    if (parsed.isNegative() && !rule.signed) {
      this.error(key, 'negative_not_allowed');
      return null;
    }
    if (rule.positive && parsed.isZero()) {
      this.error(key, 'must_be_positive');
      return null;
    }
    if (rule.max !== undefined && parsed.gt(rule.max)) {
      this.error(key, 'too_large', { max: rule.max });
      return null;
    }
    return parsed.toString();
  }

  /**
   * A calendar day as `YYYY-MM-DD`, from `JJ/MM/AAAA`, `AAAA-MM-JJ` or a real Excel date.
   * `''` when the cell is empty, null (and an error) when it is not a date.
   */
  date(key: string): string | null {
    const v = this.text(key);
    if (v === '') return '';
    const fr = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    const [y, m, d] = fr ? [fr[3], fr[2], fr[1]] : iso ? [iso[1], iso[2], iso[3]] : [];
    if (y && m && d) {
      const day = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      const parsed = new Date(`${day}T00:00:00.000Z`);
      if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day) return day;
    }
    this.error(key, 'invalid_date', { value: v });
    return null;
  }

  toDto(action: ImportRowAction | null): ImportRowDto {
    return {
      rowNumber: this.rowNumber,
      values: this.values,
      action: this.errors.length > 0 ? null : action,
      errors: this.errors,
      warnings: this.warnings,
    };
  }
}

/** Flags every row after the first that repeats a key (reference, code). */
export class DuplicateTracker {
  private readonly seen = new Map<string, number>();

  check(row: RowReader, field: string, key: string): void {
    const normalized = key.toLowerCase();
    const first = this.seen.get(normalized);
    if (first !== undefined) row.error(field, 'duplicate_in_file', { row: String(first) });
    else this.seen.set(normalized, row.rowNumber);
  }
}

export const BARCODE_PATTERN = /^[\w\-.]+$/;
