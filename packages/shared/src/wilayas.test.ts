import { describe, expect, it } from 'vitest';
import { WILAYA_MAX, WILAYA_MIN, WILAYAS, wilayaLabel, wilayaName, wilayaOf } from './wilayas';

describe('wilayas', () => {
  it('lists the 69 wilayas, numbered 1 to 69, each once', () => {
    expect(WILAYAS).toHaveLength(69);
    expect(WILAYAS.map((w) => w.code)).toEqual(Array.from({ length: 69 }, (_, i) => i + 1));
    expect(new Set(WILAYAS.map((w) => w.code)).size).toBe(69);
    expect(WILAYA_MIN).toBe(1);
    expect(WILAYA_MAX).toBe(69);
  });

  it('names every wilaya in French and in Arabic, each name once', () => {
    for (const w of WILAYAS) {
      expect(w.fr.trim()).not.toBe('');
      expect(w.ar.trim()).not.toBe('');
    }
    expect(new Set(WILAYAS.map((w) => w.fr)).size).toBe(69);
    expect(new Set(WILAYAS.map((w) => w.ar)).size).toBe(69);
  });

  it('gives the name in the language of the screen', () => {
    expect(wilayaName(28, 'fr')).toBe("M'Sila");
    expect(wilayaName(28, 'en')).toBe("M'Sila");
    expect(wilayaName(28, 'ar')).toBe('المسيلة');
    expect(wilayaLabel(5, 'fr')).toBe('05 · Batna');
  });

  it('knows no wilaya outside the list', () => {
    expect(wilayaOf(0)).toBeNull();
    expect(wilayaOf(70)).toBeNull();
    expect(wilayaOf(null)).toBeNull();
    expect(wilayaName(undefined, 'fr')).toBeNull();
    expect(wilayaLabel(99, 'ar')).toBeNull();
  });
});
