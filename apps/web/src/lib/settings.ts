'use client';

import { useQuery } from '@tanstack/react-query';
import type { TenantSettingsResponse } from '@erp/shared';
import { api } from './api-client';

/** Same key as the settings page, so a saved setting refreshes every screen. */
export function useTenantSettings() {
  return useQuery({
    queryKey: ['tenant-settings'],
    queryFn: () => api.request<TenantSettingsResponse>('/tenant/settings'),
  });
}
