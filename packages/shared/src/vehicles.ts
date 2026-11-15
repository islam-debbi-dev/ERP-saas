/** Longest code a dépôt or a truck can have (`warehouses.code`). */
export const VEHICLE_CODE_MAX = 30;

export interface ProposeVehicleCodeInput {
  /** The type's optional prefix, as the owner typed it (`VAN`, `LIV`, `PRV`). */
  prefix?: string | null;
  /** The type's own code (`MXT`, `SELF/MT`). */
  typeCode?: string | null;
  wilayaCode?: number | null;
  /** Codes already used by the company's live dépôts and trucks. */
  taken: readonly string[];
}

/**
 * A code the vehicle form proposes (phase 36): prefix + wilaya, the type's code, then the
 * next free number, e.g. `VAN-28 MXT 01`. Only a helper: the owner may type anything, and
 * nothing ever reads a code back to find a type or a wilaya (the columns hold the meaning).
 * The owner's text is kept as typed: no upper-casing, no cleaning.
 */
export function proposeVehicleCode(input: ProposeVehicleCodeInput): string {
  const prefix = input.prefix?.trim() ?? '';
  const type = input.typeCode?.trim() ?? '';
  const wilaya = input.wilayaCode ? String(input.wilayaCode).padStart(2, '0') : '';
  const head = prefix && wilaya ? `${prefix}-${wilaya}` : prefix || wilaya;
  // Room is always left for " 99".
  const base = [head, type]
    .filter((p) => p !== '')
    .join(' ')
    .slice(0, VEHICLE_CODE_MAX - 3)
    .trimEnd();
  const taken = new Set(input.taken.map((c) => c.trim().toLowerCase()));
  for (let n = 1; n < 1000; n += 1) {
    const number = String(n).padStart(2, '0');
    const code = base ? `${base} ${number}` : number;
    if (code.length <= VEHICLE_CODE_MAX && !taken.has(code.toLowerCase())) return code;
  }
  return base;
}
