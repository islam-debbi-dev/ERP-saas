import { describe, expect, it } from 'vitest';
import { type TodoItem, todoKey, type TodoType } from '@erp/shared';
import { todoAction } from './todo';

function item(type: TodoType, extra: Partial<TodoItem> = {}): TodoItem {
  return {
    key: todoKey(type, 'x1'),
    type,
    id: 'x1',
    label: 'X',
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

describe('todo actions land on the prefilled screen', () => {
  it('cheques, versements, purchases, orders and drafts', () => {
    expect(todoAction(item('CHEQUE_DUE'))).toEqual({
      kind: 'cheque',
      href: '/versements?cheque=x1',
    });
    expect(todoAction(item('CLIENT_LATE'))).toEqual({
      kind: 'versement',
      href: '/versements?nouveau=1&clientId=x1',
    });
    expect(todoAction(item('OUT_OF_STOCK_SOLD', { supplierId: 's1' }))?.href).toBe(
      '/achats/nouveau?productId=x1&supplierId=s1',
    );
    expect(todoAction(item('OUT_OF_STOCK_SOLD'))?.href).toBe('/achats/nouveau?productId=x1');
    expect(todoAction(item('ORDER_TO_CONFIRM'))?.href).toBe('/commandes/x1');
    expect(todoAction(item('DRAFT_OLD', { document: 'SALE' }))?.href).toBe(
      '/ventes/nouvelle?brouillon=x1',
    );
    expect(todoAction(item('DRAFT_OLD', { document: 'PURCHASE' }))?.href).toBe('/achats/x1');
    expect(todoAction(item('SUPPLIER_CHEQUE_DUE', { supplierId: 's1' }))?.href).toBe(
      '/achats/fournisseurs/s1',
    );
  });

  it('a client over his plafond is called when he has a phone, else opened', () => {
    expect(todoAction(item('CLIENT_OVER_LIMIT', { phone: '0550 12 34 56' }))).toEqual({
      kind: 'call',
      href: 'tel:0550123456',
    });
    expect(todoAction(item('CLIENT_OVER_LIMIT'))).toEqual({ kind: 'client', href: '/clients/x1' });
  });
});
