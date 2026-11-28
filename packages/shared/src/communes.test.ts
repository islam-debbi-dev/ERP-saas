import { describe, expect, it } from 'vitest';
import {
  COMMUNES_59_69_REVIEWED,
  communeByCode,
  communesOf,
  dairaByKey,
  dairasOf,
  findCommune,
  findWilaya,
  isCommuneUnderReview,
  resolveLocation,
  type CommuneCandidate,
  type ResolvedLocation,
} from './communes';
import { WILAYAS } from './wilayas';

const CODES = WILAYAS.map((w) => w.code);
const ALL = CODES.flatMap((w) => [...communesOf(w)]);
const ALL_DAIRAS = CODES.flatMap((w) => [...dairasOf(w)]);

// Communes per wilaya, 01 to 69. docs/review/communes-59-69.md says which of these were
// compared with the Journal officiel text.
const EXPECTED_COUNTS = [
  16, 35, 12, 29, 53, 52, 22, 11, 25, 45, // 01 to 10
  5, 24, 49, 36, 67, 57, 18, 28, 60, 16, // 11 to 20
  38, 52, 12, 34, 12, 43, 32, 24, 47, 7, // 21 to 30
  26, 15, 4, 34, 32, 24, 2, 22, 22, 21, // 31 to 40
  26, 28, 32, 36, 12, 28, 10, 38, 10, 2, // 41 to 50
  6, 10, 3, 2, 14, 2, 8, 3, 12, 8, // 51 to 60
  5, 4, 4, 6, 10, 8, 21, 23, 7, // 61 to 69
]; // prettier-ignore

const exactCodes = (candidates: CommuneCandidate[]) =>
  candidates.filter((c) => c.match === 'exact').map((c) => c.commune.code);

const outcome = ({ status, wilayaCode, communeCode }: ResolvedLocation) => ({
  status,
  wilayaCode,
  communeCode,
});
const none = (status: ResolvedLocation['status']) => ({
  status,
  wilayaCode: null,
  communeCode: null,
});
const matched = (communeCode: number, wilayaCode: number, status = 'MATCHED') => ({
  status,
  wilayaCode,
  communeCode,
});

describe('commune data', () => {
  it('has the expected number of communes in each of the 69 wilayas', () => {
    expect(CODES.map((w) => communesOf(w).length)).toEqual(EXPECTED_COUNTS);
  });

  it('has 1541 communes with unique codes', () => {
    expect(ALL).toHaveLength(1541);
    expect(new Set(ALL.map((c) => c.code)).size).toBe(1541);
  });

  it('fills the new wilayas 59 to 69', () => {
    expect(CODES.slice(58).map((w) => communesOf(w).length)).toEqual([
      12, 8, 5, 4, 4, 6, 10, 8, 21, 23, 7,
    ]);
  });

  it('has well formed communes', () => {
    for (const c of ALL) {
      expect(Number.isInteger(c.code) && c.code >= 101 && c.code <= 5899).toBe(true);
      expect(c.fr).toMatch(/[A-Za-z]/);
      expect(c.ar).toMatch(/\p{Script=Arabic}/u);
      expect(c.formerWilayaCodes).not.toContain(c.wilayaCode);
      expect(new Set(c.formerWilayaCodes).size).toBe(c.formerWilayaCodes.length);
      expect(communeByCode(c.code)).toBe(c);
    }
  });

  it('records the former wilaya of every moved commune', () => {
    for (const w of CODES.slice(58)) {
      for (const c of communesOf(w)) expect(c.formerWilayaCodes.length).toBeGreaterThan(0);
    }
    expect(communeByCode(2820)).toMatchObject({ wilayaCode: 68, formerWilayaCodes: [28] });
  });

  it('puts each daira in one wilaya and each commune in a daira of its own wilaya', () => {
    expect(new Set(ALL_DAIRAS.map((d) => d.key)).size).toBe(ALL_DAIRAS.length);
    for (const d of ALL_DAIRAS) {
      expect(dairaByKey(d.key)).toBe(d);
      expect(communesOf(d.wilayaCode).some((c) => c.dairaKey === d.key)).toBe(true);
    }
    for (const c of ALL) {
      if (c.dairaKey !== null) expect(dairaByKey(c.dairaKey)?.wilayaCode).toBe(c.wilayaCode);
    }
  });

  it('leaves unknown dairas and daira names empty instead of guessing', () => {
    expect(ALL.filter((c) => c.dairaKey === null).map((c) => c.code)).toEqual([3005]);
    expect(ALL_DAIRAS.filter((d) => d.ar === null).map((d) => d.key)).toEqual([
      '06-ifri-ouzellaguene',
      '58-mansoura',
    ]);
  });

  it('returns nothing for unknown codes', () => {
    expect(communesOf(70)).toEqual([]);
    expect(dairasOf(0)).toEqual([]);
    expect(communeByCode(9999)).toBeNull();
    expect(communeByCode(null)).toBeNull();
    expect(dairaByKey('99-nowhere')).toBeNull();
    expect(dairaByKey(undefined)).toBeNull();
  });
});

describe('findCommune', () => {
  it.each([
    ['Ténès', 202],
    ['  TENES ', 202],
    ['Bou Saada', 2820],
    ['bou-saâda', 2820],
    ['Boussaada', 2820], // alias
    ['M’Sila', 2801], // typographic apostrophe
    ['msila', 2801],
    ['Mʼsila', 2801], // modifier letter apostrophe
    ['بوسعادة', 2820],
    ['بُوسَعَادَة', 2820], // diacritics
    ['بو سعاده', 2820], // space, heh for teh marbuta
    ['المسيله', 2801],
    ['ادرار', 101], // alef without hamza
  ])('finds %s exactly', (text, code) => {
    expect(exactCodes(findCommune(text))).toEqual([code]);
  });

  it('marks a transliteration variant as loose only', () => {
    const found = findCommune('Boosaada').concat(findCommune('Bu Sada'));
    expect(exactCodes(found)).toEqual([]);
    expect(findCommune('Bu Sada').map((c) => [c.commune.code, c.match])).toContainEqual([
      2820,
      'loose',
    ]);
  });

  it('returns every commune that shares a name', () => {
    const codes = exactCodes(findCommune('Mansoura'));
    expect(codes).toEqual(expect.arrayContaining([3404, 4713]));
    expect(codes.length).toBeGreaterThan(1);
  });

  it('can be limited to one wilaya', () => {
    expect(exactCodes(findCommune('Mansoura', 34))).toEqual([3404]);
    expect(findCommune('Bou Saada', 28)).toEqual([]);
    expect(findCommune('Bou Saada', 70)).toEqual([]);
  });

  it('returns nothing for empty or unknown text', () => {
    expect(findCommune('')).toEqual([]);
    expect(findCommune(' - ')).toEqual([]);
    expect(findCommune('Sonitex')).toEqual([]);
  });

  it('finds every commune by its own French and Arabic names', () => {
    for (const c of ALL) {
      for (const name of [c.fr, c.ar]) {
        expect(exactCodes(findCommune(name, c.wilayaCode))).toContain(c.code);
      }
    }
  });
});

describe('findWilaya', () => {
  it.each([
    ["M'Sila", 28],
    ['msila', 28],
    ['المسيلة', 28],
    ['28', 28],
    [' 05 ', 5],
    ["28 · M'Sila", 28],
    ['28 - المسيلة', 28],
    ['bejaia', 6],
    ['Tamanrasset', 11],
    ['Tamanghasset', 11], // dataset spelling
    ['Aïn Ouessara', 65], // dataset spelling
    ['Bou Saâda', 68],
  ])('reads %s', (text, code) => {
    expect(findWilaya(text)).toBe(code);
  });

  it('reads every wilaya by name', () => {
    for (const w of WILAYAS) {
      expect(findWilaya(w.fr)).toBe(w.code);
      expect(findWilaya(w.ar)).toBe(w.code);
    }
  });

  it.each(['', '  ', '0', '70', '128', '028', '28 · Oran', '28 xyz', 'Msilla', 'Sonitex'])(
    'refuses %j',
    (text) => {
      expect(findWilaya(text)).toBeNull();
    },
  );

  it('accepts a missing text', () => {
    expect(findWilaya(null)).toBeNull();
    expect(findWilaya(undefined)).toBeNull();
  });
});

describe('review gate', () => {
  it('is open since the owner approved the review file', () => {
    expect(COMMUNES_59_69_REVIEWED).toBe(true);
    expect(ALL.filter((c) => isCommuneUnderReview(c.code))).toHaveLength(0);
  });

  it('covers exactly wilayas 59 to 69 when closed', () => {
    expect(ALL.filter((c) => isCommuneUnderReview(c.code, false))).toHaveLength(108);
    for (const c of ALL) expect(isCommuneUnderReview(c.code, false)).toBe(c.wilayaCode >= 59);
    expect(isCommuneUnderReview(null, false)).toBe(false);
    expect(isCommuneUnderReview(9999, false)).toBe(false);
  });

  it('can be exercised open', () => {
    expect(isCommuneUnderReview(2820, true)).toBe(false);
  });
});

describe('resolveLocation', () => {
  const resolve = (wilayaText: string | null, communeText: string | null, reviewed?: boolean) =>
    resolveLocation({ wilayaText, communeText }, { reviewed });

  it('matches a commune in the wilaya of the text', () => {
    expect(outcome(resolve("M'Sila", 'Sidi Aissa'))).toEqual(
      matched(exactCodes(findCommune('Sidi Aissa', 28))[0]!, 28),
    );
    expect(outcome(resolve('المسيلة', 'المسيلة'))).toEqual(matched(2801, 28));
    expect(outcome(resolve("28 · M'Sila", 'msila'))).toEqual(matched(2801, 28));
  });

  it('lets the wilaya settle a name that several communes share', () => {
    expect(outcome(resolve('Bordj Bou Arréridj', 'Mansoura'))).toEqual(matched(3404, 34));
  });

  it('never picks among several communes', () => {
    const result = resolve('', 'Mansoura');
    expect(outcome(result)).toEqual(none('AMBIGUOUS'));
    expect(exactCodes(result.candidates).length).toBeGreaterThan(1);
  });

  it('never sets a commune from a loose match', () => {
    const result = resolve("M'Sila", 'Mseela');
    expect(outcome(result)).toEqual(none('NO_MATCH'));
    const loose = resolve('', 'Bu Sada', true);
    expect(outcome(loose)).toEqual(none('NO_MATCH'));
    expect(loose.candidates.map((c) => c.commune.code)).toContain(2820);
  });

  it('keeps the gated commune of an old text empty while the gate is closed', () => {
    // The old text names the former wilaya of Bou Saada.
    const result = resolve("M'Sila", 'Bou Saada', false);
    expect(outcome(result)).toEqual(none('UNDER_REVIEW'));
    expect(exactCodes(result.candidates)).toEqual([2820]);
    expect(outcome(resolve('Bou Saâda', 'Bou Saada', false))).toEqual(none('UNDER_REVIEW'));
    expect(outcome(resolve(null, 'بوسعادة', false))).toEqual(none('UNDER_REVIEW'));
  });

  it('moves it to the new wilaya by default, the gate being open', () => {
    expect(outcome(resolve("M'Sila", 'Bou Saada'))).toEqual(
      matched(2820, 68, 'MATCHED_FORMER_WILAYA'),
    );
  });

  it('moves it to the new wilaya once the gate is open', () => {
    expect(outcome(resolve("M'Sila", 'Bou Saada', true))).toEqual(
      matched(2820, 68, 'MATCHED_FORMER_WILAYA'),
    );
    expect(outcome(resolve('Bou Saâda', 'Bou Saada', true))).toEqual(matched(2820, 68));
    expect(outcome(resolve(null, 'بوسعادة', true))).toEqual(matched(2820, 68));
  });

  it('does not look in the former wilaya of another wilaya', () => {
    expect(outcome(resolve('Oran', 'Bou Saada', true))).toEqual(none('NO_MATCH'));
  });

  it('keeps the wilaya alone when there is no commune text, gated wilayas included', () => {
    expect(outcome(resolve("M'Sila", '  '))).toEqual({
      status: 'WILAYA_ONLY',
      wilayaCode: 28,
      communeCode: null,
    });
    expect(outcome(resolve('68', null))).toEqual({
      status: 'WILAYA_ONLY',
      wilayaCode: 68,
      communeCode: null,
    });
  });

  it('sets nothing when the commune or the wilaya text is not recognised', () => {
    expect(outcome(resolve("M'Sila", 'Sonitex'))).toEqual(none('NO_MATCH'));
    expect(outcome(resolve('Msilla', null))).toEqual(none('NO_MATCH'));
    const result = resolve('Msilla', 'Sidi Aissa');
    expect(outcome(result)).toEqual(none('NO_MATCH'));
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it('uses a single nationwide match when there is no wilaya text', () => {
    expect(outcome(resolve('', 'Ténès'))).toEqual(matched(202, 2));
    expect(outcome(resolve('', 'Sonitex'))).toEqual(none('NO_MATCH'));
  });

  it('says when there is nothing to read', () => {
    expect(outcome(resolveLocation({}))).toEqual(none('EMPTY'));
    expect(outcome(resolve(' ', ''))).toEqual(none('EMPTY'));
  });
});
