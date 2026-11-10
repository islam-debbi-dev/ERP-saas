/**
 * "À faire aujourd'hui" (phase 33): what needs the user now. The API finds the items and
 * ranks them with these pure rules; the web writes the sentence from the messages files.
 */
import { money } from './money';

/** In priority order: money to collect first, then risk, then stock, then paperwork. */
export const TODO_TYPES = [
  'CHEQUE_DUE',
  'CLIENT_OVER_LIMIT',
  'SUPPLIER_CHEQUE_DUE',
  'CLIENT_LATE',
  'OUT_OF_STOCK_SOLD',
  'ORDER_TO_CONFIRM',
  'DRAFT_OLD',
] as const;
export type TodoType = (typeof TODO_TYPES)[number];

/** Items on the dashboard card; "Voir tout" shows the rest. */
export const TODO_CARD_CAP = 6;
/** Items the API returns at most (the full list of "Voir tout"). */
export const TODO_LIST_CAP = 50;

/** A client cheque this many days past its échéance stops being an item (no "cashed" state). */
export const CHEQUE_OVERDUE_DAYS = 7;
/** Own cheques shown this many days before their échéance. */
export const SUPPLIER_CHEQUE_LEAD_DAYS = 2;
/** "Sold recently": a sale in this many days. */
export const RECENT_SALE_DAYS = 30;
/** A draft older than this many hours. */
export const DRAFT_OLD_HOURS = 24;

export interface TodoItem {
  /** Stable: type + the row's id. Used to hide an item until tomorrow. */
  key: string;
  type: TodoType;
  /** The row the item is about: payment, client, product, order, sale or purchase. */
  id: string;
  /** Who or what, as typed by the user (client, supplier, product, document number). */
  label: string | null;
  amount: string | null;
  /** CLIENT_OVER_LIMIT: the plafond. */
  limit: string | null;
  /** OUT_OF_STOCK_SOLD: documents of the last 30 days that sold it. */
  count: number | null;
  /** The day it is about: échéance, oldest unpaid document, order or draft date. */
  date: string | null;
  /**
   * CHEQUE_DUE: days past the échéance (0 = today); SUPPLIER_CHEQUE_DUE: days left;
   * CLIENT_LATE: age of the oldest unpaid amount; ORDER / DRAFT: days waiting.
   */
  days: number | null;
  clientId: string | null;
  supplierId: string | null;
  productId: string | null;
  /** The client's phone, for "Appeler". */
  phone: string | null;
  /** DRAFT_OLD: which document to resume. */
  document: 'SALE' | 'PURCHASE' | null;
}

export interface DashboardTodoDto {
  date: string;
  /** Items found before the cap (the badge shows it). */
  total: number;
  items: TodoItem[];
}

export function todoKey(type: TodoType, id: string): string {
  return `${type}:${id}`;
}

/** How pressing an item is inside its type: bigger first. */
function urgency(i: TodoItem): number {
  switch (i.type) {
    case 'SUPPLIER_CHEQUE_DUE':
      // Fewer days left is more urgent.
      return -(i.days ?? 0);
    case 'OUT_OF_STOCK_SOLD':
      return i.count ?? 0;
    case 'CLIENT_OVER_LIMIT':
      return 0;
    default:
      return i.days ?? 0;
  }
}

/** What the amount ranks by: for a client over his plafond, by how much. */
function weight(i: TodoItem): string {
  if (i.type === 'CLIENT_OVER_LIMIT' && i.amount && i.limit)
    return money(i.amount).minus(i.limit).toFixed(2);
  return i.amount ?? '0';
}

/**
 * Most urgent first: by type, then urgency inside the type, then amount, then key so the
 * order never changes between two refreshes. One line per client: a client over his
 * plafond is not also listed as late. At most `cap` items.
 */
export function rankTodo(items: readonly TodoItem[], cap = TODO_LIST_CAP): TodoItem[] {
  const overLimit = new Set(
    items.filter((i) => i.type === 'CLIENT_OVER_LIMIT').map((i) => i.clientId),
  );
  const seen = new Set<string>();
  return items
    .filter((i) => !(i.type === 'CLIENT_LATE' && overLimit.has(i.clientId)))
    .filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)))
    .sort(
      (a, b) =>
        TODO_TYPES.indexOf(a.type) - TODO_TYPES.indexOf(b.type) ||
        urgency(b) - urgency(a) ||
        money(weight(b)).comparedTo(weight(a)) ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    )
    .slice(0, cap);
}

/** The card's items: the ranked list without the ones put off until tomorrow. */
export function visibleTodo(
  items: readonly TodoItem[],
  hidden: ReadonlySet<string>,
  cap = TODO_CARD_CAP,
): TodoItem[] {
  return items.filter((i) => !hidden.has(i.key)).slice(0, cap);
}
