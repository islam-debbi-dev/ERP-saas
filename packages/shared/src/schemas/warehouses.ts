import { z } from 'zod';
import {
  type Role,
  StockTransferType,
  WarehouseType,
  type StockTransferStatus,
  type WarehouseAccessLevel,
  type WarehouseType as WarehouseTypeValue,
} from '../enums';
import { normalizeDecimal, quantityString } from './common';
import { type StockWarning } from './stock';

const id = z.uuid();
const name = z.string().trim().min(1).max(80);

// ---------------------------------------------------------------- warehouses (WAREHOUSES)

export const createWarehouseSchema = z
  .object({
    name,
    /** MAIN is only the default dépôt, created by the system. */
    type: z.enum([WarehouseType.SECONDARY, WarehouseType.VEHICLE]),
    /** The seller driving the truck (VEHICLE only). */
    assignedUserId: id.nullable().default(null),
  })
  .refine((w) => w.assignedUserId === null || w.type === WarehouseType.VEHICLE, {
    message: 'driver_on_vehicle_only',
    path: ['assignedUserId'],
  });
export type CreateWarehouseInput = z.infer<typeof createWarehouseSchema>;

/** Omitted fields are unchanged; null clears the driver, the manager or the parent. */
export const updateWarehouseSchema = z.object({
  name: name.optional(),
  assignedUserId: id.nullable().optional(),
  active: z.boolean().optional(),
  /** The dépôt's manager (phase 24, MULTI_UNIT). */
  managerUserId: id.nullable().optional(),
  /** The dépôt a truck belongs to (VEHICLE only): it inherits its team and brands. */
  parentWarehouseId: id.nullable().optional(),
  /** The point self check-ins are measured from (phase 31). Null clears it. */
  location: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      radiusM: z.number().int().min(20).max(5000).nullable().default(null),
    })
    .nullable()
    .optional(),
});
export type UpdateWarehouseInput = z.infer<typeof updateWarehouseSchema>;

/** What a dépôt sells (phase 24): empty = everything. Replaces the whole list. */
export const warehouseBrandsSchema = z.object({
  brandIds: z
    .array(id)
    .max(500)
    .transform((v) => [...new Set(v)]),
});
export type WarehouseBrandsInput = z.infer<typeof warehouseBrandsSchema>;

export const warehouseCategoriesSchema = z.object({
  categoryIds: z
    .array(id)
    .max(500)
    .transform((v) => [...new Set(v)]),
});
export type WarehouseCategoriesInput = z.infer<typeof warehouseCategoriesSchema>;

export interface WarehouseDto {
  id: string;
  name: string;
  type: WarehouseTypeValue;
  isDefault: boolean;
  active: boolean;
  assignedUser: { id: string; fullName: string } | null;
  /** Products with stock (≠ 0) in this dépôt. */
  productCount: number;
  manager: { id: string; fullName: string } | null;
  parent: { id: string; name: string } | null;
  location: { lat: number; lng: number; radiusM: number | null } | null;
}

/** One dépôt with its team (phase 24): who works there, who sees its figures, its trucks. */
export interface WarehouseDetailDto extends WarehouseDto {
  brands: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  team: {
    id: string;
    fullName: string;
    role: Role;
    level: WarehouseAccessLevel;
  }[];
  trucks: { id: string; name: string; assignedUser: { id: string; fullName: string } | null }[];
}

// ---------------------------------------------------------------- stock transfers

export const stockTransferLineSchema = z.object({
  productId: id,
  unitId: id,
  qty: quantityString({ positive: true }).transform(normalizeDecimal),
});
export type StockTransferLineInput = z.infer<typeof stockTransferLineSchema>;

const transferFields = {
  type: z.enum([StockTransferType.LOAD, StockTransferType.UNLOAD, StockTransferType.TRANSFER]),
  fromWarehouseId: id,
  toWarehouseId: id,
  note: z.string().trim().max(255).optional(),
  /** May be empty on a draft; validation needs at least one line. */
  lines: z
    .array(stockTransferLineSchema)
    .max(300)
    .superRefine((lines, ctx) => {
      const seen = new Set<string>();
      lines.forEach((l, i) => {
        if (seen.has(l.productId))
          ctx.addIssue({ code: 'custom', message: 'duplicate_product', path: [i, 'productId'] });
        seen.add(l.productId);
      });
    }),
};

const distinct = (t: { fromWarehouseId: string; toWarehouseId: string }) =>
  t.fromWarehouseId !== t.toWarehouseId;

export const createStockTransferSchema = z
  .object(transferFields)
  .refine(distinct, { message: 'same_warehouse', path: ['toWarehouseId'] });
export type CreateStockTransferInput = z.infer<typeof createStockTransferSchema>;

/** Replaces the whole draft (header and lines). */
export const updateStockTransferSchema = createStockTransferSchema;
export type UpdateStockTransferInput = CreateStockTransferInput;

export const cancelStockTransferSchema = z.object({
  reason: z.string().trim().min(3).max(255),
});
export type CancelStockTransferInput = z.infer<typeof cancelStockTransferSchema>;

export const stockTransferListQuerySchema = z.object({
  warehouseId: id.optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type StockTransferListQuery = z.infer<typeof stockTransferListQuerySchema>;

export interface StockTransferLineDto {
  productId: string;
  reference: string;
  designation: string;
  unitId: string;
  unitCode: string;
  qty: string;
  qtyBase: string;
}

export interface StockTransferDto {
  id: string;
  number: string | null;
  type: StockTransferType;
  status: StockTransferStatus;
  from: { id: string; name: string; type: WarehouseTypeValue };
  to: { id: string; name: string; type: WarehouseTypeValue };
  note: string | null;
  cancelReason: string | null;
  createdBy: { id: string; fullName: string } | null;
  createdAt: string;
  validatedAt: string | null;
  cancelledAt: string | null;
  lines: StockTransferLineDto[];
}

export interface StockTransferSummaryDto {
  id: string;
  number: string | null;
  type: StockTransferType;
  status: StockTransferStatus;
  from: { id: string; name: string };
  to: { id: string; name: string };
  lineCount: number;
  createdAt: string;
  validatedAt: string | null;
}

export interface StockTransferPage {
  items: StockTransferSummaryDto[];
  nextCursor: string | null;
}

/** Validate / cancel answer: warnings list the dépôts left negative (WARN mode). */
export interface StockTransferResultDto {
  transfer: StockTransferDto;
  warnings: StockWarning[];
}
