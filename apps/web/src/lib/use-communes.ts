'use client';

import { useQuery } from '@tanstack/react-query';
import type { CommunesModule } from './locations';

/**
 * The commune data, in its own bundle chunk, loaded the first time a screen asks for it.
 * `import()` is the only way the web app loads `@erp/shared/communes`.
 */
export function useCommunes(enabled = true) {
  return useQuery<CommunesModule>({
    queryKey: ['communes-data'],
    queryFn: () => import('@erp/shared/communes'),
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    // A module namespace is not plain data.
    structuralSharing: false,
  });
}
