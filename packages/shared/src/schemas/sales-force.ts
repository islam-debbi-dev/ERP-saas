import { z } from 'zod';
import { type Role } from '../enums';
import { communeCodeInput, wilayaCodeInput } from './location';

const id = z.uuid();
const name = (max: number) => z.string().trim().min(1).max(max);
const reason = z.string().trim().min(3).max(255);

// ---------------------------------------------------------------- brands (core)

export const createBrandSchema = z.object({
  name: name(80),
  /** The supplier the brand is usually bought from; informational. */
  supplierId: id.nullable().default(null),
});
export type CreateBrandInput = z.infer<typeof createBrandSchema>;

export const updateBrandSchema = createBrandSchema.partial().strict();
export type UpdateBrandInput = z.infer<typeof updateBrandSchema>;

export interface BrandDto {
  id: string;
  name: string;
  supplierId: string | null;
  supplierName: string | null;
  productCount: number;
}

// ---------------------------------------------------------------- sectors (SALES_FORCE)

const sectorWilaya = z
  .string()
  .trim()
  .max(60)
  .transform((v) => (v === '' ? null : v))
  .nullable();

/** Communes covered by the sector, deduplicated case-insensitively. */
const sectorCommunes = z
  .array(name(80))
  .max(100)
  .transform((list) => {
    const seen = new Set<string>();
    return list.filter((c) => {
      const k = c.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  });

/** Official commune codes (phase 40a), without duplicates. */
const sectorCommuneCodes = z
  .array(communeCodeInput.unwrap().unwrap())
  .max(100)
  .transform((list) => [...new Set(list)]);

export const createSectorSchema = z.object({
  name: name(80),
  wilaya: sectorWilaya.default(null),
  communes: sectorCommunes.default([]),
  /** Omitted differs from null / empty: see `createClientSchema.wilayaCode`. */
  wilayaCode: wilayaCodeInput,
  communeCodes: sectorCommuneCodes.nullable().optional(),
});
export type CreateSectorInput = z.infer<typeof createSectorSchema>;

/** No defaults here: a key left out keeps what is stored. */
export const updateSectorSchema = z
  .object({
    name: name(80).optional(),
    wilaya: sectorWilaya.optional(),
    communes: sectorCommunes.optional(),
    wilayaCode: wilayaCodeInput,
    communeCodes: sectorCommuneCodes.nullable().optional(),
  })
  .strict();
export type UpdateSectorInput = z.infer<typeof updateSectorSchema>;

export interface SectorDto {
  id: string;
  name: string;
  wilaya: string | null;
  communes: string[];
  wilayaCode: number | null;
  communeCodes: number[];
  clientCount: number;
}

// ---------------------------------------------------------------- client assignment

/** Set the sector and/or the seller of many clients at once. null clears the field. */
export const clientBulkAssignSchema = z
  .object({
    clientIds: z
      .array(id)
      .min(1)
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length, 'duplicate'),
    sectorId: id.nullable().optional(),
    assignedSellerId: id.nullable().optional(),
  })
  .strict()
  .refine((v) => v.sectorId !== undefined || v.assignedSellerId !== undefined, {
    message: 'nothing_to_assign',
    path: ['sectorId'],
  });
export type ClientBulkAssignInput = z.infer<typeof clientBulkAssignSchema>;

export interface ClientBulkAssignResultDto {
  updated: number;
}

// ---------------------------------------------------------------- reassign seller / collector

export const reassignSellerSchema = z.object({ sellerId: id.nullable(), reason }).strict();
export type ReassignSellerInput = z.infer<typeof reassignSellerSchema>;

export const reassignCollectorSchema = z.object({ collectedBy: id.nullable(), reason }).strict();
export type ReassignCollectorInput = z.infer<typeof reassignCollectorSchema>;

// ---------------------------------------------------------------- team

/** A user and, under him, the users he manages (recursively). */
export interface TeamNodeDto {
  id: string;
  fullName: string;
  role: Role;
  active: boolean;
  members: TeamNodeDto[];
}
