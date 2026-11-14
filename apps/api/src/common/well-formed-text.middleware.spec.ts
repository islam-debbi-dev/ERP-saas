import { hasIllFormedText } from './well-formed-text.middleware';

describe('hasIllFormedText', () => {
  it('finds a lone surrogate in a string, deep in a body, or in a key', () => {
    expect(hasIllFormedText('bad\uD800end')).toBe(true);
    expect(hasIllFormedText('bad\uDC00end')).toBe(true);
    expect(hasIllFormedText('\uDC00\uD800')).toBe(true);
    expect(hasIllFormedText({ lines: [{ note: 'ok' }, { note: 'x\uD83D' }] })).toBe(true);
    expect(hasIllFormedText({ ['k\uD800']: 1 })).toBe(true);
  });

  it('accepts every well-formed text: Arabic, accents, emoji (a surrogate pair)', () => {
    expect(hasIllFormedText('Dépôt « été » مخزن 😀')).toBe(false);
    expect(hasIllFormedText({ a: [1, null, true, { b: '😀😀' }] })).toBe(false);
    expect(hasIllFormedText(undefined)).toBe(false);
    expect(hasIllFormedText(42)).toBe(false);
  });
});
