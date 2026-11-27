/**
 * The write rules of the official location codes (phase 40a), for clients and sectors, in
 * one place (docs/domain.md, "Wilaya, daïra, commune"). Pure: the services call these and
 * store what they return. The text is matched by `resolveLocation` of @erp/shared/communes
 * only.
 *
 * - A code sent is checked, and its French names are written into the old text columns.
 * - Codes sent as null are cleared; the text is stored as sent.
 * - Codes left out (an old app or web): they stay while the text does not change, else
 *   they follow the new text, or are cleared when it does not say one place for sure.
 */
import { ErrorCode, wilayaOf } from '@erp/shared';
import {
  type Commune,
  communeByCode,
  isCommuneUnderReview,
  type LocationStatus,
  resolveLocation,
} from '@erp/shared/communes';
import { AppException } from '../common/app-exception';

export interface ClientPlace {
  wilaya: string | null;
  commune: string | null;
  wilayaCode: number | null;
  communeCode: number | null;
}

export interface ClientPlaceInput {
  wilaya: string | null;
  commune: string | null;
  wilayaCode?: number | null;
  communeCode?: number | null;
}

export interface PlaceResult<T> {
  place: T;
  /** What the matcher said, when the codes were guessed from the text; for the audit log. */
  resolution?: string;
}

const text = (v: string | null | undefined): string => v?.trim() ?? '';
const frWilaya = (code: number): string => wilayaOf(code)!.fr;

/** `previous` holds the codes already stored: only a newly set commune is gated. */
function knownCommune(code: number, previous: readonly number[]): Commune {
  const commune = communeByCode(code);
  if (!commune) {
    throw new AppException(ErrorCode.COMMUNE_UNKNOWN, 'Unknown commune code', {
      communeCode: code,
    });
  }
  if (isCommuneUnderReview(code) && !previous.includes(code)) {
    throw new AppException(
      ErrorCode.COMMUNE_UNDER_REVIEW,
      'This commune cannot be chosen until its new wilaya is checked',
      { communeCode: code },
    );
  }
  return commune;
}

function assertSameWilaya(commune: Commune, wilayaCode: number): void {
  if (commune.wilayaCode !== wilayaCode) {
    throw new AppException(ErrorCode.COMMUNE_WILAYA_MISMATCH, 'The commune is not in this wilaya', {
      communeCode: commune.code,
      wilayaCode,
      communeWilayaCode: commune.wilayaCode,
    });
  }
}

// ---------------------------------------------------------------- clients

/** The place to store on a client; `before` is null on a create. */
export function clientPlace(
  input: ClientPlaceInput,
  before: ClientPlace | null,
): PlaceResult<ClientPlace> {
  const sent = { wilaya: input.wilaya, commune: input.commune };
  const { wilayaCode, communeCode } = input;

  if (typeof communeCode === 'number') {
    const commune = knownCommune(
      communeCode,
      before?.communeCode != null ? [before.communeCode] : [],
    );
    if (typeof wilayaCode === 'number') assertSameWilaya(commune, wilayaCode);
    return {
      place: {
        wilaya: frWilaya(commune.wilayaCode),
        commune: commune.fr,
        wilayaCode: commune.wilayaCode,
        communeCode,
      },
    };
  }
  if (typeof wilayaCode === 'number') {
    // The commune stays only when it was not mentioned, its text is the same and it is in
    // that wilaya.
    const kept =
      communeCode === undefined &&
      before !== null &&
      text(before.commune) === text(input.commune) &&
      communeByCode(before.communeCode)?.wilayaCode === wilayaCode
        ? before.communeCode
        : null;
    return {
      place: {
        wilaya: frWilaya(wilayaCode),
        commune: kept === null ? input.commune : communeByCode(kept)!.fr,
        wilayaCode,
        communeCode: kept,
      },
    };
  }
  if (wilayaCode === null || communeCode === null) {
    return { place: { ...sent, wilayaCode: null, communeCode: null } };
  }

  // Both left out.
  if (
    text(before?.wilaya) === text(input.wilaya) &&
    text(before?.commune) === text(input.commune)
  ) {
    return {
      place: {
        ...sent,
        wilayaCode: before?.wilayaCode ?? null,
        communeCode: before?.communeCode ?? null,
      },
    };
  }
  const found = resolveLocation({ wilayaText: input.wilaya, communeText: input.commune });
  return { place: placeFromText(sent, found), resolution: found.status };
}

/** The codes the matcher is sure of, with their French names; else the text as it is. */
export function placeFromText(
  sent: { wilaya: string | null; commune: string | null },
  found: { wilayaCode: number | null; communeCode: number | null },
): ClientPlace {
  const { wilayaCode, communeCode } = found;
  return {
    wilaya: wilayaCode === null ? sent.wilaya : frWilaya(wilayaCode),
    commune: communeCode === null ? sent.commune : communeByCode(communeCode)!.fr,
    wilayaCode,
    communeCode,
  };
}

// ---------------------------------------------------------------- sectors

export interface SectorPlace {
  wilaya: string | null;
  communes: string[];
  wilayaCode: number | null;
  communeCodes: number[];
}

export interface SectorPlaceInput {
  wilaya?: string | null;
  communes?: string[];
  wilayaCode?: number | null;
  communeCodes?: number[] | null;
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => {
  const key = (list: readonly string[]) => JSON.stringify(list.map(text).sort());
  return key(a) === key(b);
};

/** Old sector text -> codes: only when every commune is found for sure in one wilaya. */
function sectorFromText(
  wilaya: string | null,
  communes: string[],
): { wilayaCode: number | null; communeCodes: number[]; resolution: string } {
  const none = (resolution: string) => ({ wilayaCode: null, communeCodes: [], resolution });
  const names = communes.map(text).filter(Boolean);
  if (names.length === 0) {
    const found = resolveLocation({ wilayaText: wilaya });
    return { wilayaCode: found.wilayaCode, communeCodes: [], resolution: found.status };
  }
  const found = names.map((communeText) => resolveLocation({ wilayaText: wilaya, communeText }));
  const sure: readonly LocationStatus[] = ['MATCHED', 'MATCHED_FORMER_WILAYA'];
  const failed = found.find((r) => !sure.includes(r.status));
  if (failed) return none(failed.status);
  if (new Set(found.map((r) => r.wilayaCode)).size > 1) return none('SEVERAL_WILAYAS');
  return {
    wilayaCode: found[0]!.wilayaCode,
    communeCodes: [...new Set(found.map((r) => r.communeCode!))],
    resolution: found.some((r) => r.status === 'MATCHED_FORMER_WILAYA')
      ? 'MATCHED_FORMER_WILAYA'
      : 'MATCHED',
  };
}

/**
 * The place to store on a sector; `before` is null on a create. A text key left out keeps
 * the stored text.
 */
export function sectorPlace(
  input: SectorPlaceInput,
  before: SectorPlace | null,
): PlaceResult<SectorPlace> {
  const wilaya = input.wilaya === undefined ? (before?.wilaya ?? null) : input.wilaya;
  const communes = input.communes ?? before?.communes ?? [];
  const previous = before?.communeCodes ?? [];
  const { wilayaCode, communeCodes } = input;

  if (communeCodes && communeCodes.length > 0) {
    const found = communeCodes.map((code) => knownCommune(code, previous));
    const target = wilayaCode ?? found[0]!.wilayaCode;
    for (const commune of found) assertSameWilaya(commune, target);
    return {
      place: {
        wilaya: frWilaya(target),
        communes: found.map((c) => c.fr),
        wilayaCode: target,
        communeCodes,
      },
    };
  }
  // The communes were all removed: their French names go with them. Text typed before
  // there were codes is never removed this way.
  const textAfterRemoval =
    communeCodes !== undefined && previous.length > 0 && input.communes === undefined
      ? []
      : communes;
  if (typeof wilayaCode === 'number') {
    const kept =
      communeCodes === undefined &&
      sameList(communes, before?.communes ?? []) &&
      previous.every((c) => communeByCode(c)?.wilayaCode === wilayaCode)
        ? previous
        : [];
    return {
      place: {
        wilaya: frWilaya(wilayaCode),
        communes: textAfterRemoval,
        wilayaCode,
        communeCodes: kept,
      },
    };
  }
  if (wilayaCode === null || communeCodes !== undefined) {
    return { place: { wilaya, communes: textAfterRemoval, wilayaCode: null, communeCodes: [] } };
  }

  // Both left out.
  if (text(before?.wilaya) === text(wilaya) && sameList(before?.communes ?? [], communes)) {
    return {
      place: {
        wilaya,
        communes,
        wilayaCode: before?.wilayaCode ?? null,
        communeCodes: previous,
      },
    };
  }
  const guess = sectorFromText(wilaya, communes);
  return {
    place: {
      wilaya: guess.wilayaCode === null ? wilaya : frWilaya(guess.wilayaCode),
      communes: guess.communeCodes.length
        ? guess.communeCodes.map((c) => communeByCode(c)!.fr)
        : communes,
      wilayaCode: guess.wilayaCode,
      communeCodes: guess.communeCodes,
    },
    resolution: guess.resolution,
  };
}
