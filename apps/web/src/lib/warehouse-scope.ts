'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { Feature, type WarehouseDto, WarehouseType } from '@erp/shared';
import { useAuth, useFeature } from './auth';
import { useWarehouses } from './stock';

/**
 * The dépôt the header switcher filters on (phase 24, MULTI_UNIT), remembered per user on
 * this browser. '' = every dépôt the user sees. Lists, reports and the dashboard send it
 * as `?warehouseId=`; the API still limits everything to the user's reach.
 */
const EVENT = 'erp:warehouse-change';
const keyOf = (userId: string) => `erp:warehouse:${userId}`;

function read(userId: string | undefined): string {
  if (!userId) return '';
  try {
    return window.localStorage.getItem(keyOf(userId)) ?? '';
  } catch {
    return '';
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export interface WarehouseScope {
  /** '' = all. Always one of `options`. */
  warehouseId: string;
  setWarehouseId: (id: string) => void;
  /** The dépôts (not trucks) the user can pick. */
  options: WarehouseDto[];
  /** The switcher shows only with the module and more than one dépôt. */
  show: boolean;
}

export function useWarehouseScope(): WarehouseScope {
  const { state } = useAuth();
  const userId = state.user?.id;
  const multiUnit = useFeature(Feature.MULTI_UNIT);
  const warehouses = useWarehouses();
  const options = useMemo(
    () => (warehouses.data ?? []).filter((w) => w.type !== WarehouseType.VEHICLE && w.active),
    [warehouses.data],
  );
  const stored = useSyncExternalStore(
    subscribe,
    () => read(userId),
    () => '',
  );
  const show = multiUnit && options.length > 1;
  const warehouseId = show && options.some((w) => w.id === stored) ? stored : '';
  const setWarehouseId = useCallback(
    (id: string) => {
      if (!userId) return;
      try {
        if (id) window.localStorage.setItem(keyOf(userId), id);
        else window.localStorage.removeItem(keyOf(userId));
      } catch {
        // Private mode or blocked storage: the choice just lasts until reload.
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [userId],
  );
  return { warehouseId, setWarehouseId, options, show };
}

/** The `?warehouseId=` lists add: the switcher's dépôt, '' for all. */
export function useWarehouseFilter(): string {
  return useWarehouseScope().warehouseId;
}
