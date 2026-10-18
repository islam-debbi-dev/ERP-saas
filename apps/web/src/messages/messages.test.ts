import { describe, expect, it } from 'vitest';
import ar from './ar.json';
import en from './en.json';
import fr from './fr.json';
import { ErrorCode } from '@erp/shared';

function keys(obj: unknown, prefix = ''): string[] {
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe('messages files', () => {
  const reference = keys(fr).sort();

  it.each([
    ['ar', ar],
    ['en', en],
  ])('%s has exactly the same keys as fr', (_locale, messages) => {
    expect(keys(messages).sort()).toEqual(reference);
  });

  it.each([
    ['ar', ar],
    ['fr', fr],
    ['en', en],
  ])('%s has no empty strings', (_locale, messages) => {
    const empty = keys(messages).filter((k) => {
      const value = k
        .split('.')
        .reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], messages);
      return typeof value !== 'string' || value.trim() === '';
    });
    expect(empty).toEqual([]);
  });

  it('translates every API error code', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(Object.keys(fr.errors)).toContain(code);
    }
  });
});
