import { describe, expect, it } from 'vitest';
import {
  createClientSchema,
  createSectorSchema,
  updateClientSchema,
  updateSectorSchema,
} from '@erp/shared';
import * as communes from '@erp/shared/communes';
import {
  clientLocationFields,
  clientOldText,
  communeDisplay,
  communeOptions,
  dairaDisplay,
  dairaOptions,
  filterOptions,
  searchKey,
  sectorCommuneNames,
  sectorLocationFields,
  sectorOldText,
  type StoredClientPlace,
  type StoredSectorPlace,
  wilayaValueCode,
} from './locations';

const oldClient: StoredClientPlace = {
  wilaya: 'msila (ancien)',
  commune: 'bousaada centre',
  wilayaCode: null,
  communeCode: null,
};
const codedClient: StoredClientPlace = {
  wilaya: 'Alger',
  commune: 'Bab Ezzouar',
  wilayaCode: 16,
  communeCode: 1621,
};

describe('what the client form sends', () => {
  it('leaves the codes out and the old text as it is while untouched', () => {
    const sent = clientLocationFields(oldClient, null);
    expect(sent).toEqual({ wilaya: 'msila (ancien)', commune: 'bousaada centre' });
    expect(sent).not.toHaveProperty('wilayaCode');
    expect(sent).not.toHaveProperty('communeCode');
    // Also once validated: the API must see the keys as left out.
    const parsed = updateClientSchema.parse({ code: 'C1', name: 'A', version: 1, ...sent });
    expect(parsed.wilayaCode).toBeUndefined();
    expect(parsed.communeCode).toBeUndefined();
    expect(parsed.commune).toBe('bousaada centre');
  });

  it('sends nothing but empty text for an untouched new client', () => {
    expect(clientLocationFields(null, null)).toEqual({ wilaya: '', commune: '' });
    expect(
      createClientSchema.parse({ code: 'C1', name: 'A', wilaya: '', commune: '' }),
    ).toMatchObject({ wilaya: null, commune: null });
  });

  it('sends both codes for a picked commune', () => {
    expect(clientLocationFields(oldClient, { wilayaCode: 28, communeCode: 2801 })).toMatchObject({
      wilayaCode: 28,
      communeCode: 2801,
    });
  });

  it('wilaya only: keeps typed commune text of a client that never had a commune code', () => {
    expect(clientLocationFields(oldClient, { wilayaCode: 28, communeCode: null })).toEqual({
      wilaya: 'msila (ancien)',
      commune: 'bousaada centre',
      wilayaCode: 28,
      communeCode: null,
    });
  });

  it('wilaya only: empties a commune name that came from a code', () => {
    expect(clientLocationFields(codedClient, { wilayaCode: 28, communeCode: null })).toMatchObject({
      commune: '',
      wilayaCode: 28,
      communeCode: null,
    });
  });

  it('cleared: both codes null and the text empty', () => {
    expect(clientLocationFields(codedClient, { wilayaCode: null, communeCode: null })).toEqual({
      wilaya: '',
      commune: '',
      wilayaCode: null,
      communeCode: null,
    });
  });

  it('shows as old text only what has no code', () => {
    expect(clientOldText(oldClient)).toBe('bousaada centre, msila (ancien)');
    expect(clientOldText(codedClient)).toBe('');
    expect(clientOldText({ ...codedClient, communeCode: null, commune: 'cité 5' })).toBe('cité 5');
  });
});

const oldSector: StoredSectorPlace = {
  wilaya: 'Alger est',
  communes: ['bab zouar', 'harrach'],
  wilayaCode: null,
  communeCodes: [],
};
const codedSector: StoredSectorPlace = {
  wilaya: 'Alger',
  communes: ['Bab Ezzouar'],
  wilayaCode: 16,
  communeCodes: [1621],
};

describe('what the sector form sends', () => {
  it('leaves the codes out and the old text as it is while untouched', () => {
    const sent = sectorLocationFields(oldSector, null);
    expect(sent).toEqual({ wilaya: 'Alger est', communes: ['bab zouar', 'harrach'] });
    const parsed = updateSectorSchema.parse({ name: 'S', ...sent });
    expect(parsed.wilayaCode).toBeUndefined();
    expect(parsed.communeCodes).toBeUndefined();
  });

  it('creates an untouched sector without any place', () => {
    expect(
      createSectorSchema.parse({ name: 'S', ...sectorLocationFields(null, null) }),
    ).toMatchObject({ wilaya: null, communes: [] });
  });

  it('sends the codes of picked communes', () => {
    expect(
      sectorLocationFields(oldSector, { wilayaCode: 16, communeCodes: [1621, 1613] }),
    ).toMatchObject({ wilayaCode: 16, communeCodes: [1621, 1613] });
  });

  it('wilaya only, or every chip removed: leaves the text out so the API decides', () => {
    const sent = sectorLocationFields(codedSector, { wilayaCode: 16, communeCodes: [] });
    expect(sent).toEqual({ wilayaCode: 16, communeCodes: [] });
    const parsed = updateSectorSchema.parse({ name: 'S', ...sent });
    expect(parsed).not.toHaveProperty('communes');
    expect(parsed).not.toHaveProperty('wilaya');
  });

  it('cleared: no codes and no text', () => {
    expect(sectorLocationFields(codedSector, { wilayaCode: null, communeCodes: [] })).toEqual({
      wilaya: null,
      communes: [],
      wilayaCode: null,
      communeCodes: [],
    });
  });

  it('shows as old text only what has no code', () => {
    expect(sectorOldText(oldSector)).toBe('bab zouar, harrach, Alger est');
    expect(sectorOldText(codedSector)).toBe('');
  });
});

describe('search and names', () => {
  it('ignores case, accents, hyphens, apostrophes and Arabic letter variants', () => {
    expect(searchKey("M'Sila")).toBe(searchKey('msila'));
    expect(searchKey('Béjaïa')).toBe(searchKey('BEJAIA'));
    expect(searchKey('أولاد')).toBe(searchKey('اولاد'));
    expect(searchKey('مَدينة')).toBe(searchKey('مدينه'));
    expect(searchKey('٢٨')).toBe('28');
  });

  it('finds a commune in French or Arabic, whatever the screen language', () => {
    const options = communeOptions(communes, 28, null, 'fr', 'x');
    const bousaada = communes.findCommune("M'Sila", 28)[0]!.commune;
    for (const query of ['msila', 'M SILA', bousaada.ar]) {
      expect(filterOptions(options, query)[0]!.id).toBe(String(bousaada.code));
    }
    expect(filterOptions(options, 'zzzz')).toEqual([]);
  });

  it('names communes in Arabic in ar and in French otherwise', () => {
    const adrar = communes.communeByCode(101)!;
    expect(communeDisplay(communes, 101, 'old', 'ar')).toBe(adrar.ar);
    expect(communeDisplay(communes, 101, 'old', 'en')).toBe(adrar.fr);
    // No code, or the data not loaded yet: the stored text.
    expect(communeDisplay(communes, null, 'old', 'ar')).toBe('old');
    expect(communeDisplay(undefined, 101, 'old', 'ar')).toBe('old');
    expect(sectorCommuneNames(communes, { communes: ['x'], communeCodes: [101] }, 'ar')).toEqual([
      adrar.ar,
    ]);
  });

  it('shows the French name of a daïra without an Arabic one', () => {
    expect(dairaDisplay({ fr: 'Mansoura', ar: null }, 'ar')).toBe('Mansoura');
    const missing = dairaOptions(communes, 58, 'ar').filter((o) => o.keywords.length === 1);
    expect(missing.map((o) => o.label)).toContain(missing[0]!.keywords[0]);
  });

  it('keeps a commune without a daïra reachable when no daïra is chosen', () => {
    const rouissat = communes.communeByCode(3005)!;
    expect(rouissat.dairaKey).toBeNull();
    const all = communeOptions(communes, rouissat.wilayaCode, null, 'fr', 'x');
    expect(all.map((o) => o.id)).toContain('3005');
    const daira = communes.dairasOf(rouissat.wilayaCode)[0]!.key;
    const narrowed = communeOptions(communes, rouissat.wilayaCode, daira, 'fr', 'x');
    expect(narrowed.map((o) => o.id)).not.toContain('3005');
  });

  it('marks the communes under review, and no other', () => {
    const closed = {
      ...communes,
      isCommuneUnderReview: (code: number | null | undefined) =>
        communes.isCommuneUnderReview(code, false),
    };
    expect(
      communeOptions(closed, 60, null, 'fr', 'review').every((o) => o.disabledReason === 'review'),
    ).toBe(true);
    expect(communeOptions(communes, 60, null, 'fr', 'review').some((o) => o.disabledReason)).toBe(
      false,
    );
    expect(communeOptions(communes, 16, null, 'fr', 'review').some((o) => o.disabledReason)).toBe(
      false,
    );
  });

  it('reads the wilaya of a statistics link: a number, or an old name', () => {
    expect(wilayaValueCode('28', undefined)).toBe(28);
    expect(wilayaValueCode('99', undefined)).toBeNull();
    expect(wilayaValueCode("M'Sila", communes)).toBe(28);
    expect(wilayaValueCode('nowhere', communes)).toBeNull();
  });
});
