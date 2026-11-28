/**
 * The official location codes on screen (phase 40a): names, search and what the forms send.
 *
 * Never import a value of `@erp/shared/communes` here or anywhere else in the web app: the
 * data is large and only loaded when a screen needs it (`useCommunes`). Types are fine.
 * The write rules are the API's (apps/api/src/locations/location-codes.ts).
 */
import { type CreateSectorInput, wilayaName } from '@erp/shared';
import type * as communesData from '@erp/shared/communes';

export type CommunesModule = typeof communesData;

// ---------------------------------------------------------------- search

/** What two spellings share: no case, accents, Arabic marks, spaces, hyphens or apostrophes. */
export function searchKey(text: string): string {
  return (
    text
      // NFD splits accents, and the hamza or madda of a letter, into combining marks.
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replaceAll('œ', 'oe')
      .replaceAll('ى', 'ي')
      .replaceAll('ی', 'ي')
      .replaceAll('ة', 'ه')
      .replaceAll('ک', 'ك')
      .replaceAll('ٱ', 'ا')
      .replaceAll('ـ', '')
      // Arabic-Indic digits, as an Arabic keyboard types them.
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[^\p{L}\p{N}]|[ʹʻʼʽʾʿˈ]/gu, '')
  );
}

export interface LocationOption {
  id: string;
  label: string;
  /** Every spelling the search looks in: French, Arabic, other spellings, the number. */
  keywords: string[];
  /** Shown but not selectable, with this short reason under the name. */
  disabledReason?: string;
}

/** The options a query keeps: those with a spelling that starts with it come first. */
export function filterOptions(options: LocationOption[], query: string): LocationOption[] {
  const wanted = searchKey(query);
  if (!wanted) return options;
  const starts: LocationOption[] = [];
  const contains: LocationOption[] = [];
  for (const option of options) {
    const keys = option.keywords.map(searchKey);
    if (keys.some((k) => k.startsWith(wanted))) starts.push(option);
    else if (keys.some((k) => k.includes(wanted))) contains.push(option);
  }
  return [...starts, ...contains];
}

// ---------------------------------------------------------------- names

const byLabel = (locale: string) => (a: LocationOption, b: LocationOption) =>
  a.label.localeCompare(b.label, locale);

/** The wilaya's name from its code, in the screen's language; else the stored text. */
export function wilayaDisplay(
  code: number | null,
  stored: string | null,
  locale: string,
): string | null {
  return wilayaName(code, locale) ?? stored;
}

/** The commune's name from its code; else (or while the data loads) the stored text. */
export function communeDisplay(
  data: CommunesModule | undefined,
  code: number | null,
  stored: string | null,
  locale: string,
): string | null {
  const commune = data?.communeByCode(code);
  if (!commune) return stored;
  return locale === 'ar' ? commune.ar : commune.fr;
}

/** A daïra without an Arabic name shows its French one. */
export function dairaDisplay(daira: { fr: string; ar: string | null }, locale: string): string {
  return locale === 'ar' ? (daira.ar ?? daira.fr) : daira.fr;
}

/**
 * The names of a sector's communes: from the codes in the screen's language, else the
 * stored text.
 */
export function sectorCommuneNames(
  data: CommunesModule | undefined,
  sector: { communes: string[]; communeCodes: number[] },
  locale: string,
): string[] {
  if (sector.communeCodes.length === 0) return sector.communes;
  return sector.communeCodes.map(
    (code, i) => communeDisplay(data, code, sector.communes[i] ?? null, locale) ?? String(code),
  );
}

export function dairaOptions(
  data: CommunesModule,
  wilayaCode: number,
  locale: string,
): LocationOption[] {
  return data
    .dairasOf(wilayaCode)
    .map((d) => ({
      id: d.key,
      label: dairaDisplay(d, locale),
      keywords: d.ar ? [d.fr, d.ar] : [d.fr],
    }))
    .sort(byLabel(locale));
}

/**
 * The communes of a wilaya, of one daïra when given. A commune without a daïra is only
 * listed without that filter. Communes under review are listed but not selectable.
 */
export function communeOptions(
  data: CommunesModule,
  wilayaCode: number,
  dairaKey: string | null,
  locale: string,
  underReview: string,
): LocationOption[] {
  return data
    .communesOf(wilayaCode)
    .filter((c) => dairaKey === null || c.dairaKey === dairaKey)
    .map((c) => ({
      id: String(c.code),
      label: locale === 'ar' ? c.ar : c.fr,
      keywords: [c.fr, c.ar, ...c.aliases],
      ...(data.isCommuneUnderReview(c.code) ? { disabledReason: underReview } : {}),
    }))
    .sort(byLabel(locale));
}

/**
 * The wilaya number a `clientWilayas` value of a statistics link means: a number, or
 * (old links) a name, which needs the commune data. Null when unknown.
 */
export function wilayaValueCode(value: string, data: CommunesModule | undefined): number | null {
  if (/^\d{1,2}$/.test(value)) return wilayaName(Number(value), 'fr') ? Number(value) : null;
  return data?.findWilaya(value) ?? null;
}

// ---------------------------------------------------------------- what the forms send

export interface PlaceSelection {
  wilayaCode: number | null;
  communeCode: number | null;
}

export interface StoredClientPlace {
  wilaya: string | null;
  commune: string | null;
  wilayaCode: number | null;
  communeCode: number | null;
}

export interface ClientPlaceFields {
  wilaya: string;
  commune: string;
  wilayaCode?: number | null;
  communeCode?: number | null;
}

/**
 * The location keys of a client form. `picked` is null while the user has not touched the
 * location: the codes are then left out and the stored text goes back unchanged, so old
 * text is never lost. `stored` is null for a new client.
 */
export function clientLocationFields(
  stored: StoredClientPlace | null,
  picked: PlaceSelection | null,
): ClientPlaceFields {
  const wilaya = stored?.wilaya ?? '';
  const commune = stored?.commune ?? '';
  if (picked === null) return { wilaya, commune };
  if (picked.communeCode !== null) {
    // The API writes the French names of the codes over the text.
    return { wilaya, commune, wilayaCode: picked.wilayaCode, communeCode: picked.communeCode };
  }
  if (picked.wilayaCode !== null) {
    return {
      wilaya,
      // A name that came from a code goes with its code; typed text stays.
      commune: (stored?.communeCode ?? null) === null ? commune : '',
      wilayaCode: picked.wilayaCode,
      communeCode: null,
    };
  }
  return { wilaya: '', commune: '', wilayaCode: null, communeCode: null };
}

export interface SectorSelection {
  wilayaCode: number | null;
  communeCodes: number[];
}

export interface StoredSectorPlace extends SectorSelection {
  wilaya: string | null;
  communes: string[];
}

export type SectorPlaceFields = Partial<
  Pick<CreateSectorInput, 'wilaya' | 'communes' | 'wilayaCode' | 'communeCodes'>
>;

/** The same principles for a sector (see `sectorPlace` in the API). */
export function sectorLocationFields(
  stored: StoredSectorPlace | null,
  picked: SectorSelection | null,
): SectorPlaceFields {
  const wilaya = stored?.wilaya ?? null;
  const communes = stored?.communes ?? [];
  if (picked === null) return { wilaya, communes };
  if (picked.communeCodes.length > 0) {
    return {
      wilaya,
      communes,
      wilayaCode: picked.wilayaCode,
      communeCodes: picked.communeCodes,
    };
  }
  if (picked.wilayaCode !== null) {
    // The text is left out: the API drops the names that came from codes and keeps the
    // ones typed before there were codes.
    return { wilayaCode: picked.wilayaCode, communeCodes: [] };
  }
  return { wilaya: null, communes: [], wilayaCode: null, communeCodes: [] };
}

/** The old typed text to show as a note: what has no code yet. Empty when nothing. */
export function clientOldText(stored: StoredClientPlace): string {
  return [
    stored.communeCode === null ? stored.commune : null,
    stored.wilayaCode === null ? stored.wilaya : null,
  ]
    .filter(Boolean)
    .join(', ');
}

export function sectorOldText(stored: StoredSectorPlace): string {
  return [
    ...(stored.communeCodes.length === 0 ? stored.communes : []),
    stored.wilayaCode === null ? stored.wilaya : null,
  ]
    .filter(Boolean)
    .join(', ');
}
