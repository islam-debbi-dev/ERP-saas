/** Default batch size for bulk inserts and `IN (...)` lists (imports). */
export const CHUNK_SIZE = 500;

/** Splits a list into consecutive slices of at most `size` items. */
export function chunks<T>(items: readonly T[], size = CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
