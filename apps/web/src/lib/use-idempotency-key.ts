'use client';

import { useState } from 'react';

/** One idempotency key per opening of a dialog: a retry of the same submit is a replay. */
export function useIdempotencyKey(open: boolean): string {
  const [state, setState] = useState({ open, key: crypto.randomUUID() });
  if (state.open !== open) {
    const next = { open, key: open ? crypto.randomUUID() : state.key };
    setState(next);
    return next.key;
  }
  return state.key;
}
