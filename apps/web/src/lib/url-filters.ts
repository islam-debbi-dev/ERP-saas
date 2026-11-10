'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import type { z } from 'zod';

/**
 * A list's filters kept in the URL (phase 33), so the back button, a refresh and a shared
 * link keep them, and the dashboard can open a list already filtered. Each key is checked
 * with a zod schema (usually a field of the list's query schema): an unknown or invalid
 * value is dropped, never an error.
 */
export type UrlFilterSpec = Record<string, z.ZodType>;
export type UrlFilters<S extends UrlFilterSpec> = { [K in keyof S]: string };

/** The valid filters of `params`; '' for a missing or invalid one. */
export function parseUrlFilters<S extends UrlFilterSpec>(
  spec: S,
  params: { get(key: string): string | null },
): UrlFilters<S> {
  const out = {} as Record<string, string>;
  for (const key of Object.keys(spec)) {
    const raw = params.get(key);
    out[key] = raw !== null && raw !== '' && spec[key]!.safeParse(raw).success ? raw : '';
  }
  return out as UrlFilters<S>;
}

/** `params` with `patch` applied: '' removes a key; other keys are kept as they are. */
export function patchSearch(
  params: { toString(): string },
  patch: Record<string, string | undefined>,
): string {
  const next = new URLSearchParams(params.toString());
  for (const [key, value] of Object.entries(patch)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  return next.toString();
}

/**
 * The filters of the current URL and a setter that replaces the URL (no new history
 * entry per change). `spec` must be a module constant. Needs a Suspense boundary above.
 */
export function useUrlFilters<S extends UrlFilterSpec>(
  spec: S,
): [UrlFilters<S>, (patch: Partial<UrlFilters<S>>) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const value = useMemo(() => parseUrlFilters(spec, params), [spec, params]);
  const set = useCallback(
    (patch: Partial<UrlFilters<S>>) => {
      const qs = patchSearch(params, patch);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  return [value, set];
}
