import { z } from 'zod';
import { type Role, ZONE_KINDS, type ZoneKind } from '../enums';
import { WILAYA_MAX, WILAYA_MIN } from '../wilayas';

/**
 * Field zones and seller zone assignments (phase 40b). Whether a commune exists, is free and
 * is inside the right area is decided by the API (`ZONE_*` and `COMMUNE_*` errors).
 */

const id = z.uuid();
const communeCodes = z
  .array(z.number().int().positive())
  .max(1600)
  .transform((v) => [...new Set(v)]);
const wilayaCodes = z
  .array(z.number().int().min(WILAYA_MIN).max(WILAYA_MAX))
  .max(WILAYA_MAX)
  .transform((v) => [...new Set(v)]);

const zoneFields = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(ZONE_KINDS as [ZoneKind, ...ZoneKind[]]),
  /** The area a city zone sits in. An area has none. */
  parentZoneId: id.nullable().default(null),
  /** Whole wilayas: each counts as all its communes. */
  wilayaCodes: wilayaCodes.default([]),
  communeCodes: communeCodes.default([]),
  /** An area: a chef de zone. A city: a supervisor or a chef de zone. */
  responsibleUserId: id.nullable().default(null),
});

type ZoneShape = z.output<typeof zoneFields>;
const checkZone = (v: ZoneShape, ctx: z.core.$RefinementCtx<ZoneShape>) => {
  if (v.kind === 'AREA' && v.parentZoneId !== null) {
    ctx.addIssue({ code: 'custom', message: 'area_has_no_parent', path: ['parentZoneId'] });
  }
  if (v.wilayaCodes.length === 0 && v.communeCodes.length === 0) {
    ctx.addIssue({ code: 'custom', message: 'required', path: ['communeCodes'] });
  }
};

export const createZoneSchema = zoneFields.superRefine(checkZone);
export type CreateZoneInput = z.infer<typeof createZoneSchema>;

/** Replaces the zone. `version` guards against two edits of the same screen. */
export const updateZoneSchema = zoneFields
  .extend({ version: z.number().int().positive() })
  .superRefine(checkZone);
export type UpdateZoneInput = z.infer<typeof updateZoneSchema>;

/** Where a seller or pré-vendeur works from now on: one zone, or a list of communes. */
export const assignSellerZoneSchema = z
  .object({ zoneId: id.optional(), communeCodes: communeCodes.optional() })
  .strict()
  .refine((v) => (v.zoneId === undefined) !== (v.communeCodes === undefined), {
    message: 'zone_or_communes',
    path: ['zoneId'],
  })
  .refine((v) => v.communeCodes === undefined || v.communeCodes.length > 0, {
    message: 'required',
    path: ['communeCodes'],
  });
export type AssignSellerZoneInput = z.infer<typeof assignSellerZoneSchema>;

export const zoneAssignmentQuerySchema = z.object({
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ZoneAssignmentQuery = z.infer<typeof zoneAssignmentQuerySchema>;

// ---------------------------------------------------------------- responses

export interface ZoneDto {
  id: string;
  name: string;
  kind: ZoneKind;
  parentZoneId: string | null;
  parentZoneName: string | null;
  wilayaCodes: number[];
  communeCodes: number[];
  responsible: { id: string; fullName: string; role: Role } | null;
  version: number;
}

export interface SellerZoneAssignmentDto {
  id: string;
  userId: string;
  /** Set when he was assigned to a zone: his communes follow the zone. */
  zone: { id: string; name: string; deleted: boolean } | null;
  /** The communes listed on the row, or what the zone covers today. */
  communeCodes: number[];
  validFrom: string;
  /** Null: the current assignment. */
  validTo: string | null;
  assignedBy: { id: string; fullName: string } | null;
}

export interface SellerZoneAssignmentPage {
  /** The open assignment, or null. */
  current: SellerZoneAssignmentDto | null;
  /** Newest first, the current one included. */
  items: SellerZoneAssignmentDto[];
  nextCursor: string | null;
}
