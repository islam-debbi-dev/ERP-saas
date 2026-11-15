import { z } from 'zod';
import { VEHICLE_ACTIVITIES, type VehicleActivity } from '../enums';
import { VEHICLE_CODE_MAX } from '../vehicles';
import { WILAYA_MAX, WILAYA_MIN } from '../wilayas';

const id = z.uuid();

/** '' = nothing typed = null. */
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();

interface UserRef {
  id: string;
  fullName: string;
}

// ---------------------------------------------------------------- vehicle types

const typeFields = {
  /** The company's own code (`MXT`, `SELF/MT`, `HRC`): never one of ours. */
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(80),
  /** Start of the proposed vehicle codes (`VAN`, `LIV`, `PRV`). */
  codePrefix: nullableText(10),
  activity: z.enum(VEHICLE_ACTIVITIES),
};

export const createVehicleTypeSchema = z.object({
  ...typeFields,
  codePrefix: typeFields.codePrefix.default(null),
});
export type CreateVehicleTypeInput = z.infer<typeof createVehicleTypeSchema>;

export const updateVehicleTypeSchema = z
  .object({ ...typeFields, active: z.boolean() })
  .partial()
  .strict();
export type UpdateVehicleTypeInput = z.infer<typeof updateVehicleTypeSchema>;

export interface VehicleTypeDto {
  id: string;
  code: string;
  name: string;
  codePrefix: string | null;
  activity: VehicleActivity;
  active: boolean;
  /** Live trucks of this type. */
  vehicleCount: number;
}

/** What screens show of a truck's type. */
export interface VehicleTypeRef {
  id: string;
  code: string;
  name: string;
  activity: VehicleActivity;
}

/** A truck named on a route, a visit or an order. `code` is shown as typed, never translated. */
export interface VehicleRef {
  id: string;
  code: string | null;
  name: string;
}

// ---------------------------------------------------------------- vehicle identity

/**
 * The identity of a truck (VEHICLE dépôts only; a MAIN / SECONDARY dépôt may only have a
 * `code`). Omitted = unchanged, null = cleared.
 */
export const vehicleIdentityFields = {
  code: nullableText(VEHICLE_CODE_MAX).optional(),
  vehicleTypeId: id.nullable().optional(),
  wilayaCode: z.number().int().min(WILAYA_MIN).max(WILAYA_MAX).nullable().optional(),
  /** Matricule, free text. */
  plateNumber: nullableText(20).optional(),
  /** Payload in kg (phase 37: fill rate). */
  capacityKg: z.number().int().min(1).max(1_000_000).nullable().optional(),
};

/** The identity fields a dépôt that is not a truck must not carry. */
export const VEHICLE_ONLY_FIELDS = [
  'vehicleTypeId',
  'wilayaCode',
  'plateNumber',
  'capacityKg',
] as const;

// ---------------------------------------------------------------- drivers

/** Today's driver of a truck; null = the truck stays without a driver. */
export const assignDriverSchema = z.object({
  userId: id.nullable(),
  reason: z
    .string()
    .trim()
    .max(120)
    .transform((v) => (v === '' ? undefined : v))
    .optional(),
});
export type AssignDriverInput = z.infer<typeof assignDriverSchema>;

export const vehicleAssignmentListQuerySchema = z.object({
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type VehicleAssignmentListQuery = z.infer<typeof vehicleAssignmentListQuerySchema>;

/** One line of a truck's driver history: from `fromAt`, this user (or nobody) drives it. */
export interface VehicleAssignmentDto {
  id: string;
  user: UserRef | null;
  fromAt: string;
  setBy: UserRef | null;
  reason: string | null;
}

export interface VehicleAssignmentPage {
  items: VehicleAssignmentDto[];
  nextCursor: string | null;
}

/** One period a worker drove a truck. `toAt` null = he still drives it. */
export interface WorkerVehiclePeriodDto {
  id: string;
  vehicle: VehicleRef & {
    type: { code: string; name: string } | null;
    /** False = outside the reader's dépôts: shown by its code, without a link. */
    inReach: boolean;
  };
  fromAt: string;
  toAt: string | null;
  setBy: UserRef | null;
}

export interface WorkerVehiclePage {
  items: WorkerVehiclePeriodDto[];
  nextCursor: string | null;
}

/** What a driver change did (the other truck is the one the driver left). */
export interface AssignDriverResultDto {
  vehicleId: string;
  driver: UserRef | null;
  previousDriver: UserRef | null;
  /** The truck the new driver was taken off, when he had one. */
  freedVehicle: VehicleRef | null;
}

/** `POST /routes/convert-to-vehicle`: how many seller routes became vehicle routes. */
export interface ConvertRoutesResultDto {
  converted: number;
  /** Seller routes left as they are: their seller drives no truck. */
  skipped: number;
}
