'use client';

import { useCallback, useMemo } from 'react';
import { useAuth, useFeatures } from '@/lib/auth';
import { useHasOverview } from '@/lib/overview';
import { type NavGroup, NAV_ITEMS, visibleNavGroups } from './navigation';

/**
 * The menu this user sees: modules, role, permissions, plus the two runtime rules
 * (Vue d'ensemble with more than one dépôt, "Mon pointage" with an employee file).
 */
export function useVisibleNavGroups(): NavGroup[] {
  const features = useFeatures();
  const user = useAuth().state.user;
  const role = user?.role;
  const permissions = user?.permissions;
  const hasOverview = useHasOverview() === true;
  const hasEmployeeFile = Boolean(user?.employeeId);
  return useMemo(
    () =>
      visibleNavGroups(features, undefined, role, permissions)
        .map((g) => ({
          ...g,
          items: g.items.filter(
            (i) =>
              (i.key !== 'overview' || hasOverview) &&
              ((i.key !== 'myAttendance' && i.key !== 'myPayslips') || hasEmployeeFile),
          ),
        }))
        .filter((g) => g.items.length > 0),
    [features, role, permissions, hasOverview, hasEmployeeFile],
  );
}

/**
 * Whether the user may open a link (phase 33): its page's menu item must be visible to
 * him. A path no menu item covers is allowed (cards, documents: the API still checks).
 */
export function useCanOpen(): (href: string) => boolean {
  const groups = useVisibleNavGroups();
  return useCallback(
    (href: string) => {
      const path = href.split('?')[0]!;
      const owner = NAV_ITEMS.filter((i) => path === i.url || path.startsWith(`${i.url}/`)).sort(
        (a, b) => b.url.length - a.url.length,
      )[0];
      if (!owner) return true;
      return groups.some((g) => g.items.some((i) => i.key === owner.key));
    },
    [groups],
  );
}
