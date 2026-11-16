import { z } from 'zod';
import {
  type ImportFieldDef,
  type ImportMapping,
  type ImportStatus,
  type ImportType,
  IMPORT_TYPES,
} from '../imports';

export const importTypeSchema = z.enum(IMPORT_TYPES as [ImportType, ...ImportType[]]);

/** Field key → column index (null = column absent). */
export const importMappingSchema = z.record(
  z.string().max(40),
  z.number().int().min(0).max(500).nullable(),
);

/**
 * Multipart fields of `POST /imports/:type/preview`, next to the `file` part.
 * `mapping` is JSON text (multipart has no nested objects). Without a file,
 * `jobId` re-previews the stored file of an earlier preview with a new mapping.
 */
export const importPreviewBodySchema = z.object({
  mapping: z
    .string()
    .max(20_000)
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === '') return undefined;
      try {
        return importMappingSchema.parse(JSON.parse(v));
      } catch {
        ctx.addIssue({ code: 'custom', message: 'invalid_mapping' });
        return z.NEVER;
      }
    }),
  jobId: z.uuid().optional(),
});
export type ImportPreviewBody = z.infer<typeof importPreviewBodySchema>;

/**
 * Body of `POST /imports/:id/confirm`. A client file may name segments ("Type") that do
 * not exist: the preview lists them, and they are created only when the owner says so here;
 * otherwise those clients are imported without a segment.
 */
export const importConfirmBodySchema = z
  .object({ createSegments: z.boolean().default(false) })
  .default({ createSegments: false });
export type ImportConfirmBody = z.infer<typeof importConfirmBodySchema>;

export const importListQuerySchema = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ImportListQuery = z.infer<typeof importListQuerySchema>;

/**
 * One problem on a row. `code` is translated by the web (`imports.issues.<code>`);
 * `params` fill its placeholders.
 */
export interface ImportIssue {
  field?: string;
  code: string;
  params?: Record<string, string>;
}

export type ImportRowAction = 'CREATE' | 'UPDATE' | 'OPENING';

export interface ImportRowDto {
  /** Line number in the spreadsheet (header is line 1). */
  rowNumber: number;
  /** Raw cell text per mapped field. */
  values: Record<string, string>;
  /** What confirm will do; null when the row has errors. */
  action: ImportRowAction | null;
  errors: ImportIssue[];
  warnings: ImportIssue[];
}

export interface ImportCounts {
  total: number;
  valid: number;
  errors: number;
  warnings: number;
  creates: number;
  updates: number;
}

export interface ImportPreviewDto {
  jobId: string;
  type: ImportType;
  fileName: string;
  headers: string[];
  fields: ImportFieldDef[];
  mapping: ImportMapping;
  /** Errors not tied to a row (a required column is not mapped). */
  fileErrors: ImportIssue[];
  rows: ImportRowDto[];
  counts: ImportCounts;
}

export interface ImportJobDto {
  id: string;
  type: ImportType;
  status: ImportStatus;
  fileName: string;
  totalRows: number;
  errorRows: number;
  warningRows: number;
  createdRows: number;
  updatedRows: number;
  /** Opening stock lines or opening balances written. */
  openingRows: number;
  /** False once the original file passed its retention period. */
  fileAvailable: boolean;
  createdBy: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

export interface ImportJobPage {
  items: ImportJobDto[];
  nextCursor: string | null;
}
