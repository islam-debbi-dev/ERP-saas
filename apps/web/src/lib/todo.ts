'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { type DashboardTodoDto, type TodoItem, visibleTodo } from '@erp/shared';
import { api } from './api-client';
import { useAuth } from './auth';

export const todoKeys = { all: ['dashboard', 'todo'] as const };

/** "À faire aujourd'hui" (phase 33): ranked by the API. */
export function useTodo(enabled = true) {
  return useQuery({
    queryKey: todoKeys.all,
    queryFn: ({ signal }) => api.request<DashboardTodoDto>('/dashboard/todo', { signal }),
    enabled,
    staleTime: 30_000,
  });
}

/** The one action of an item: a page (prefilled by its URL) or a phone call. */
export interface TodoAction {
  kind: 'cheque' | 'supplier' | 'call' | 'client' | 'versement' | 'order' | 'confirm' | 'resume';
  href: string;
}

export function todoAction(i: TodoItem): TodoAction | null {
  switch (i.type) {
    case 'CHEQUE_DUE':
      return { kind: 'cheque', href: `/versements?cheque=${i.id}` };
    case 'SUPPLIER_CHEQUE_DUE':
      return i.supplierId
        ? { kind: 'supplier', href: `/achats/fournisseurs/${i.supplierId}` }
        : null;
    case 'CLIENT_OVER_LIMIT':
      return i.phone
        ? { kind: 'call', href: `tel:${i.phone.replace(/\s/g, '')}` }
        : { kind: 'client', href: `/clients/${i.id}` };
    case 'CLIENT_LATE':
      return { kind: 'versement', href: `/versements?nouveau=1&clientId=${i.id}` };
    case 'OUT_OF_STOCK_SOLD': {
      const qs = new URLSearchParams({ productId: i.id });
      if (i.supplierId) qs.set('supplierId', i.supplierId);
      return { kind: 'order', href: `/achats/nouveau?${qs.toString()}` };
    }
    case 'ORDER_TO_CONFIRM':
      return { kind: 'confirm', href: `/commandes/${i.id}` };
    case 'DRAFT_OLD':
      return {
        kind: 'resume',
        href: i.document === 'PURCHASE' ? `/achats/${i.id}` : `/ventes/nouvelle?brouillon=${i.id}`,
      };
  }
}

/** Algiers day of now (UTC+1, no DST). */
function algiersToday(): string {
  return new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
}

function storageKey(userId: string, day: string): string {
  return `erp.todo.later.${userId}.${day}`;
}

function readHidden(userId: string, day: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(storageKey(userId, day));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

const EMPTY: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
let cache: { key: string; set: ReadonlySet<string> } | null = null;

function snapshot(userId: string, day: string): ReadonlySet<string> {
  const key = storageKey(userId, day);
  if (cache?.key !== key) cache = { key, set: readHidden(userId, day) };
  return cache.set;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * "Plus tard": an item hidden on this device until tomorrow (per user and Algiers day; a
 * convenience, not business data, so localStorage). One store for the card and the
 * menu badge; yesterday's list is dropped when a new one is written.
 */
export function useTodoLater() {
  const userId = useAuth().state.user?.id ?? 'anonymous';
  const day = algiersToday();
  const hidden = useSyncExternalStore(
    subscribe,
    () => snapshot(userId, day),
    () => EMPTY,
  );
  const later = useCallback(
    (key: string) => {
      const next = new Set(snapshot(userId, day)).add(key);
      cache = { key: storageKey(userId, day), set: next };
      try {
        for (let n = window.localStorage.length - 1; n >= 0; n--) {
          const k = window.localStorage.key(n);
          if (k?.startsWith(`erp.todo.later.${userId}.`) && k !== storageKey(userId, day))
            window.localStorage.removeItem(k);
        }
        window.localStorage.setItem(storageKey(userId, day), JSON.stringify([...next]));
      } catch {
        // Private mode or blocked storage: hidden for this visit only.
      }
      for (const l of listeners) l();
    },
    [userId, day],
  );
  return { hidden, later };
}

/** The card's items and how many are left in all (the badge), without the hidden ones. */
export function useVisibleTodo(enabled = true) {
  const query = useTodo(enabled);
  const { hidden, later } = useTodoLater();
  const items = query.data?.items;
  return useMemo(() => {
    const all = (items ?? []).filter((i) => !hidden.has(i.key));
    return {
      query,
      all,
      shown: visibleTodo(all, EMPTY),
      count: all.length,
      later,
    };
  }, [items, hidden, later, query]);
}
