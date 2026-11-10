import { describe, expect, it } from 'vitest';
import {
  rankTodo,
  TODO_CARD_CAP,
  type TodoItem,
  todoKey,
  type TodoType,
  visibleTodo,
} from './todo';

function item(type: TodoType, id: string, extra: Partial<TodoItem> = {}): TodoItem {
  return {
    key: todoKey(type, id),
    type,
    id,
    label: id,
    amount: null,
    limit: null,
    count: null,
    date: null,
    days: null,
    clientId: null,
    supplierId: null,
    productId: null,
    phone: null,
    document: null,
    ...extra,
  };
}

describe('rankTodo', () => {
  it('ranks by type: cheques to cash, plafonds, own cheques, late, stock, orders, drafts', () => {
    const ranked = rankTodo([
      item('DRAFT_OLD', 'd'),
      item('ORDER_TO_CONFIRM', 'o'),
      item('OUT_OF_STOCK_SOLD', 'p'),
      item('CLIENT_LATE', 'l', { clientId: 'c2' }),
      item('SUPPLIER_CHEQUE_DUE', 's'),
      item('CLIENT_OVER_LIMIT', 'c1', { clientId: 'c1', amount: '200', limit: '100' }),
      item('CHEQUE_DUE', 'q'),
    ]);
    expect(ranked.map((i) => i.type)).toEqual([
      'CHEQUE_DUE',
      'CLIENT_OVER_LIMIT',
      'SUPPLIER_CHEQUE_DUE',
      'CLIENT_LATE',
      'OUT_OF_STOCK_SOLD',
      'ORDER_TO_CONFIRM',
      'DRAFT_OLD',
    ]);
  });

  it('inside a type: the most overdue cheque, then the biggest amount, then the key', () => {
    const ranked = rankTodo([
      item('CHEQUE_DUE', 'a', { days: 0, amount: '900' }),
      item('CHEQUE_DUE', 'b', { days: 3, amount: '10' }),
      item('CHEQUE_DUE', 'c', { days: 0, amount: '1000' }),
      item('CHEQUE_DUE', 'd', { days: 0, amount: '1000' }),
    ]);
    expect(ranked.map((i) => i.id)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('own cheques: the fewest days left first; over limit: the biggest excess first', () => {
    expect(
      rankTodo([
        item('SUPPLIER_CHEQUE_DUE', 'later', { days: 2 }),
        item('SUPPLIER_CHEQUE_DUE', 'today', { days: 0 }),
      ]).map((i) => i.id),
    ).toEqual(['today', 'later']);
    expect(
      rankTodo([
        item('CLIENT_OVER_LIMIT', 'big', { clientId: 'big', amount: '1000', limit: '900' }),
        item('CLIENT_OVER_LIMIT', 'far', { clientId: 'far', amount: '500', limit: '100' }),
      ]).map((i) => i.id),
    ).toEqual(['far', 'big']);
  });

  it('a client over his plafond is not listed late too; duplicates are dropped', () => {
    const ranked = rankTodo([
      item('CLIENT_OVER_LIMIT', 'c1', { clientId: 'c1', amount: '200', limit: '100' }),
      item('CLIENT_LATE', 'c1', { clientId: 'c1', days: 90 }),
      item('CLIENT_LATE', 'c2', { clientId: 'c2', days: 40 }),
      item('CLIENT_LATE', 'c2', { clientId: 'c2', days: 40 }),
    ]);
    expect(ranked.map((i) => i.key)).toEqual(['CLIENT_OVER_LIMIT:c1', 'CLIENT_LATE:c2']);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 80 }, (_, n) => item('DRAFT_OLD', `d${n}`, { days: n }));
    expect(rankTodo(many)).toHaveLength(50);
    expect(rankTodo(many, 3).map((i) => i.id)).toEqual(['d79', 'd78', 'd77']);
  });
});

describe('visibleTodo', () => {
  it('the card shows 6 items at most, without the ones put off until tomorrow', () => {
    const ranked = rankTodo(
      Array.from({ length: 9 }, (_, n) => item('DRAFT_OLD', `d${n}`, { days: 9 - n })),
    );
    expect(TODO_CARD_CAP).toBe(6);
    expect(visibleTodo(ranked, new Set())).toHaveLength(6);
    const shown = visibleTodo(ranked, new Set(['DRAFT_OLD:d0', 'DRAFT_OLD:d2']));
    expect(shown.map((i) => i.id)).toEqual(['d1', 'd3', 'd4', 'd5', 'd6', 'd7']);
  });
});
