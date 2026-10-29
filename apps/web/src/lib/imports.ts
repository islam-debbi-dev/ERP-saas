'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import type {
  ImportFieldDef,
  ImportJobDto,
  ImportJobPage,
  ImportMapping,
  ImportPreviewDto,
  ImportType,
} from '@erp/shared';
import { api } from './api-client';

export const importKeys = {
  all: ['imports'] as const,
  list: ['imports', 'list'] as const,
};

export function useImportPages() {
  return useInfiniteQuery({
    queryKey: importKeys.list,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '20' });
      if (pageParam) params.set('cursor', pageParam);
      return api.request<ImportJobPage>(`/imports?${params.toString()}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Uploads a file (first preview) or re-previews a stored file with a new mapping. */
export function previewImport(
  type: ImportType,
  source: { file: File } | { jobId: string; mapping: ImportMapping },
): Promise<ImportPreviewDto> {
  const form = new FormData();
  if ('file' in source) form.append('file', source.file, source.file.name);
  else {
    form.append('jobId', source.jobId);
    form.append('mapping', JSON.stringify(source.mapping));
  }
  return api.request<ImportPreviewDto>(`/imports/${type}/preview`, { method: 'POST', body: form });
}

export function confirmImport(jobId: string, idempotencyKey: string): Promise<ImportJobDto> {
  return api.request<ImportJobDto>(`/imports/${jobId}/confirm`, {
    method: 'POST',
    idempotencyKey,
  });
}

const TEMPLATE_NAMES: Record<ImportType, string> = {
  PRODUCTS: 'modele-import-produits.xlsx',
  OPENING_STOCK: 'modele-import-stock-initial.xlsx',
  CLIENTS: 'modele-import-clients.xlsx',
  SUPPLIERS: 'modele-import-fournisseurs.xlsx',
};

/** Saves the .xlsx template (with the tenant's price level names) through a temporary link. */
export async function downloadTemplate(type: ImportType): Promise<void> {
  const blob = await api.download(`/imports/templates/${type}`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = TEMPLATE_NAMES[type];
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** `price.2` → `{ prefix: 'price', position: '2' }`; null for non-price fields. */
export function priceSlot(field: ImportFieldDef): { pack: 0 | 1 | 2 } | null {
  const [prefix] = field.key.split('.');
  if (prefix === 'price') return { pack: 0 };
  if (prefix === 'pack1Price') return { pack: 1 };
  if (prefix === 'pack2Price') return { pack: 2 };
  return null;
}
