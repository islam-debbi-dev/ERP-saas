'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type {
  ImportFileDto,
  ImportFilePage,
  ImportFileStatus,
  LandedCostPreviewDto,
} from '@erp/shared';
import { api } from './api-client';

/** Dossiers d'importation (phase 22, IMPORT_COSTS). */
export const importFileKeys = {
  all: ['import-files'] as const,
  list: (status: ImportFileStatus | '', search: string) =>
    ['import-files', 'list', status, search] as const,
  one: (id: string) => ['import-files', id] as const,
  preview: (id: string) => ['import-files', id, 'preview'] as const,
};

export function useImportFilePages(status: ImportFileStatus | '', search: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: importFileKeys.list(status, search),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '50' });
      if (status) params.set('status', status);
      if (search) params.set('search', search);
      if (pageParam) params.set('cursor', pageParam);
      return api.request<ImportFilePage>(`/import-files?${params.toString()}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

/** The open dossiers a draft BR can join (first 100). */
export function useOpenImportFiles(enabled: boolean) {
  return useQuery({
    // Not the infinite list's key: the cached shapes differ.
    queryKey: ['import-files', 'open'] as const,
    queryFn: () => api.request<ImportFilePage>('/import-files?status=OPEN&limit=100'),
    enabled,
  });
}

export function useImportFile(id: string) {
  return useQuery({
    queryKey: importFileKeys.one(id),
    queryFn: () => api.request<ImportFileDto>(`/import-files/${id}`),
  });
}

export function useLandedCostPreview(id: string, version: number | undefined) {
  return useQuery({
    queryKey: [...importFileKeys.preview(id), version],
    queryFn: () => api.request<LandedCostPreviewDto>(`/import-files/${id}/preview`),
    enabled: version !== undefined,
  });
}
