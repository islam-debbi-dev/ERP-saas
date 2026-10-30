import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  IMPORT_FILE_RETENTION_DAYS,
  type ImportCounts,
  importFields,
  type ImportFieldDef,
  type ImportIssue,
  type ImportJobDto,
  type ImportJobPage,
  type ImportListQuery,
  type ImportMapping,
  type ImportPreviewDto,
  type ImportRowDto,
  ImportStatus,
  ImportType,
  detectMapping,
  StockMovementType,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CatalogService } from '../catalog/catalog.service';
import { ClientAccountService } from '../clients/client-account.service';
import { ClientsService } from '../clients/clients.service';
import { AppException } from '../common/app-exception';
import { chunks } from '../common/chunks';
import { tenantContext } from '../common/tenant-context';
import { type ImportJob, Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { SupplierAccountService } from '../purchases/supplier-account.service';
import { SuppliersService } from '../purchases/suppliers.service';
import { StockService } from '../stock/stock.service';
import { WarehousesService } from '../stock/warehouses.service';
import { type ImportTable, readTable } from './file-reader';
import { type ClientPlan, validateClients } from './validators/clients';
import { type OpeningStockPlan, validateOpeningStock } from './validators/opening-stock';
import { cellText } from './validators/row-reader';
import { type SupplierPlan, validateSuppliers } from './validators/suppliers';
import {
  productKeys,
  type ProductPlan,
  validateProducts,
  type ValidatedRow,
} from './validators/products';

/** One confirm may write ~10 000 rows in a single transaction. */
const CONFIRM_TX = { timeout: 300_000, maxWait: 15_000 };
const PREVIEW_TX = { timeout: 120_000, maxWait: 15_000 };
/** Row errors kept on the job for the history screen. */
const STORED_ERRORS = 200;

export interface UploadedImportFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

type AnyPlan = ProductPlan | OpeningStockPlan | ClientPlan | SupplierPlan;

interface Validation {
  fields: ImportFieldDef[];
  mapping: ImportMapping;
  fileErrors: ImportIssue[];
  rows: ValidatedRow<AnyPlan>[];
}

/** Columns read for lists: the file itself stays in the database. */
const jobSummary = {
  id: true,
  type: true,
  status: true,
  fileName: true,
  totalRows: true,
  errorRows: true,
  warningRows: true,
  createdRows: true,
  updatedRows: true,
  openingRows: true,
  createdBy: true,
  createdAt: true,
  confirmedAt: true,
  fileExpiresAt: true,
} satisfies Prisma.ImportJobSelect;

type JobSummary = Prisma.ImportJobGetPayload<{ select: typeof jobSummary }>;

function toJobDto(j: JobSummary): ImportJobDto {
  return {
    id: j.id,
    type: j.type,
    status: j.status,
    fileName: j.fileName,
    totalRows: j.totalRows,
    errorRows: j.errorRows,
    warningRows: j.warningRows,
    createdRows: j.createdRows,
    updatedRows: j.updatedRows,
    openingRows: j.openingRows,
    // The janitor drops the bytes once expired; the list never loads them.
    fileAvailable: j.fileExpiresAt.getTime() > Date.now(),
    createdBy: j.createdBy,
    createdAt: j.createdAt.toISOString(),
    confirmedAt: j.confirmedAt?.toISOString() ?? null,
  };
}

/**
 * Excel / CSV imports: preview validates every row and writes nothing but the
 * ImportJob; confirm re-validates against the current data and writes all rows
 * in one transaction through the owning modules (catalog, stock, clients, suppliers).
 */
@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
    private readonly stock: StockService,
    private readonly warehouses: WarehousesService,
    private readonly clients: ClientsService,
    private readonly accounts: ClientAccountService,
    private readonly suppliers: SuppliersService,
    private readonly supplierAccounts: SupplierAccountService,
  ) {}

  async preview(
    type: ImportType,
    source: { file?: UploadedImportFile; jobId?: string; mapping?: ImportMapping },
  ): Promise<ImportPreviewDto> {
    let file: { name: string; mime: string; data: Buffer };
    let job: { id: string } | null = null;
    if (source.file) {
      file = {
        name: source.file.originalname.slice(0, 255),
        mime: source.file.mimetype.slice(0, 120),
        data: source.file.buffer,
      };
    } else if (source.jobId) {
      const found = await this.prisma.db.importJob.findUnique({ where: { id: source.jobId } });
      if (!found || found.type !== type) {
        throw new AppException(ErrorCode.NOT_FOUND, 'Import not found');
      }
      if (found.status === ImportStatus.COMPLETED) {
        throw new AppException(ErrorCode.IMPORT_NOT_PENDING, 'Import already confirmed');
      }
      if (!found.fileData) {
        throw new AppException(ErrorCode.IMPORT_FILE_INVALID, 'File no longer kept', {
          reason: 'file_expired',
        });
      }
      file = { name: found.fileName, mime: found.fileMime, data: Buffer.from(found.fileData) };
      job = found;
    } else {
      throw new AppException(ErrorCode.IMPORT_FILE_INVALID, 'No file', { reason: 'no_file' });
    }

    const table = await readTable(file.data, file.name, file.mime);
    const validation = await this.prisma.db.$transaction(
      (tx) => this.validate(tx, type, table, source.mapping),
      PREVIEW_TX,
    );
    const counts = countRows(validation.rows);
    const data = {
      mapping: validation.mapping,
      status: ImportStatus.PREVIEWED,
      totalRows: counts.total,
      errorRows: counts.errors,
      warningRows: counts.warnings,
      errors: storedErrors(validation),
    };

    const saved = await this.prisma.db.$transaction(async (tx) => {
      if (job) {
        return tx.importJob.update({ where: { id: job.id }, data, select: { id: true } });
      }
      const created = await tx.importJob.create({
        data: {
          ...data,
          tenantId: tenantContext.requireTenantId(),
          type,
          fileName: file.name,
          fileMime: file.mime,
          fileData: new Uint8Array(file.data),
          fileExpiresAt: new Date(Date.now() + IMPORT_FILE_RETENTION_DAYS * 86_400_000),
          createdBy: tenantContext.get()?.userId ?? null,
        },
        select: { id: true },
      });
      await this.audit.log(tx, {
        action: 'IMPORT_PREVIEWED',
        entity: 'ImportJob',
        entityId: created.id,
        after: { type, fileName: file.name, counts },
      });
      return created;
    });

    return {
      jobId: saved.id,
      type,
      fileName: file.name,
      headers: table.headers,
      fields: validation.fields,
      mapping: validation.mapping,
      fileErrors: validation.fileErrors,
      rows: validation.rows.map((r) => rowDto(r)),
      counts,
    };
  }

  /**
   * All or nothing: any row that is invalid now (data changed since the preview)
   * or any write that fails rolls the whole import back; the job is then marked
   * FAILED with the reason, outside the rolled-back transaction.
   */
  async confirm(id: string, user: CurrentUserInfo): Promise<ImportJobDto> {
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const job = await this.lockJob(tx, id);
        if (job.status !== ImportStatus.PREVIEWED) {
          throw new AppException(
            ErrorCode.IMPORT_NOT_PENDING,
            'Import is not waiting for confirmation',
            {
              status: job.status,
            },
          );
        }
        if (!job.fileData) {
          throw new AppException(ErrorCode.IMPORT_FILE_INVALID, 'File no longer kept', {
            reason: 'file_expired',
          });
        }
        const table = await readTable(Buffer.from(job.fileData), job.fileName, job.fileMime);
        const validation = await this.validate(tx, job.type, table, job.mapping as ImportMapping);
        const counts = countRows(validation.rows);
        if (validation.fileErrors.length > 0 || counts.errors > 0) {
          throw new AppException(ErrorCode.IMPORT_HAS_ERRORS, 'Some rows are invalid', {
            fileErrors: validation.fileErrors,
            rows: validation.rows
              .filter((r) => r.row.errors.length > 0)
              .slice(0, STORED_ERRORS)
              .map((r) => ({ rowNumber: r.row.rowNumber, errors: r.row.errors })),
          });
        }

        const plans = validation.rows.flatMap((r) => (r.plan ? [r.plan] : []));
        const written = await this.write(tx, job, plans, user);
        const updated = await tx.importJob.update({
          where: { id },
          select: jobSummary,
          data: {
            status: ImportStatus.COMPLETED,
            totalRows: counts.total,
            errorRows: 0,
            warningRows: counts.warnings,
            createdRows: written.created,
            updatedRows: written.updated,
            openingRows: written.opening,
            errors: [],
            confirmedAt: new Date(),
          },
        });
        await this.audit.log(tx, {
          action: 'IMPORT_CONFIRMED',
          entity: 'ImportJob',
          entityId: id,
          after: { type: job.type, fileName: job.fileName, ...written },
        });
        return toJobDto(updated);
      }, CONFIRM_TX);
    } catch (err) {
      await this.markFailed(id, err);
      throw err;
    }
  }

  async list(query: ImportListQuery): Promise<ImportJobPage> {
    const rows = await this.prisma.db.importJob.findMany({
      select: jobSummary,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const items = rows.slice(0, query.limit).map(toJobDto);
    return { items, nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null };
  }

  /** Active price levels, for the template's price columns. */
  async priceLevels(): Promise<{ position: number; name: string }[]> {
    return this.prisma.db.$transaction(
      async (tx) => (await this.catalog.importLookups(tx)).priceLevels,
    );
  }

  // ---------------------------------------------------------------- validation

  private async validate(
    tx: Tx,
    type: ImportType,
    table: ImportTable,
    requested: ImportMapping | undefined,
  ): Promise<Validation> {
    const lookups = await this.catalog.importLookups(tx);
    const fields = importFields(type, lookups.priceLevels);
    const mapping = cleanMapping(requested ?? detectMapping(table.headers, fields), fields, table);
    const fileErrors: ImportIssue[] = fields
      .filter((f) => f.required && mapping[f.key] === null)
      .map((f) => ({ field: f.key, code: 'required_column_missing' }));

    let rows: ValidatedRow<AnyPlan>[];
    if (type === ImportType.PRODUCTS) {
      const keys = productKeys(table, mapping);
      rows = validateProducts(table, mapping, fields, {
        catalog: lookups,
        existing: await this.catalog.productsByReference(tx, keys.references),
        usedBarcodes: await this.catalog.usedBarcodes(tx, keys.barcodes),
      });
    } else if (type === ImportType.OPENING_STOCK) {
      const refs = columnValues(table, mapping, 'reference');
      const products = await this.catalog.productsByReference(tx, refs);
      rows = validateOpeningStock(table, mapping, fields, {
        units: lookups.units,
        products,
        levels: await this.stock.levelsSnapshot(
          tx,
          [...products.values()].map((p) => p.id),
        ),
      });
    } else if (type === ImportType.SUPPLIERS) {
      const codes = columnValues(table, mapping, 'code');
      rows = validateSuppliers(table, mapping, fields, await this.suppliers.byCodes(tx, codes));
    } else {
      const codes = columnValues(table, mapping, 'code');
      rows = validateClients(table, mapping, fields, await this.clients.byCodes(tx, codes));
    }
    return { fields, mapping, fileErrors, rows };
  }

  // ---------------------------------------------------------------- writes

  private async write(
    tx: Tx,
    job: ImportJob,
    plans: AnyPlan[],
    user: CurrentUserInfo,
  ): Promise<{ created: number; updated: number; opening: number }> {
    if (job.type === ImportType.PRODUCTS) return this.writeProducts(tx, plans as ProductPlan[]);
    if (job.type === ImportType.OPENING_STOCK) {
      return this.writeOpeningStock(tx, job, plans as OpeningStockPlan[]);
    }
    if (job.type === ImportType.SUPPLIERS) {
      return this.writeSuppliers(tx, job, plans as SupplierPlan[]);
    }
    return this.writeClients(tx, job, plans as ClientPlan[], user);
  }

  /** Suppliers and their solde initial (OPENING on the supplier account, phase 21). */
  private async writeSuppliers(tx: Tx, job: ImportJob, plans: SupplierPlan[]) {
    const openings: { supplierId: string; amount: string }[] = [];
    let created = 0;
    let updated = 0;
    for (const p of plans) {
      let supplierId: string;
      if (p.kind === 'CREATE') {
        supplierId = (await this.suppliers.createInTx(tx, p.input)).id;
        created++;
      } else {
        supplierId = p.id;
        if (p.input) {
          await this.suppliers.updateInTx(tx, p.id, p.input);
          updated++;
        }
      }
      if (p.opening) openings.push({ supplierId, amount: p.opening });
    }
    for (const chunk of chunks(openings)) {
      await this.supplierAccounts.post(
        tx,
        chunk.map((o) => ({
          supplierId: o.supplierId,
          type: 'OPENING',
          amount: o.amount,
          label: 'Solde initial (import)',
          refType: 'IMPORT',
          refId: job.id,
        })),
      );
    }
    return { created, updated, opening: openings.length };
  }

  private async writeProducts(tx: Tx, plans: ProductPlan[]) {
    const categoryIds = await this.catalog.ensureCategories(
      tx,
      plans.flatMap((p) => (p.categoryName ? [p.categoryName] : [])),
    );
    const brandIds = await this.catalog.ensureBrands(
      tx,
      plans.flatMap((p) => (p.brandName ? [p.brandName] : [])),
    );
    const withNames = <T extends { categoryId: string | null; brandId?: string | null }>(
      input: T,
      plan: { categoryName: string | null; brandName: string | null },
    ): T => ({
      ...input,
      ...(plan.categoryName
        ? { categoryId: categoryIds.get(plan.categoryName.trim().toLowerCase()) ?? null }
        : {}),
      ...(plan.brandName
        ? { brandId: brandIds.get(plan.brandName.trim().toLowerCase()) ?? null }
        : {}),
    });

    const creates = plans.flatMap((p) => (p.kind === 'CREATE' ? [withNames(p.input, p)] : []));
    await this.catalog.createProducts(tx, creates);
    let updated = 0;
    for (const p of plans) {
      if (p.kind !== 'UPDATE' || !p.input) continue;
      await this.catalog.updateProduct(tx, p.id, withNames(p.input, p));
      updated++;
    }
    return { created: creates.length, updated, opening: 0 };
  }

  private async writeOpeningStock(tx: Tx, job: ImportJob, plans: OpeningStockPlan[]) {
    // Opening stock from Excel lands in the main dépôt; trucks are loaded with transfers.
    const warehouseId = await this.warehouses.defaultId(tx);
    for (const chunk of chunks(plans)) {
      await this.stock.applyMovements(
        tx,
        chunk.map((p) => ({
          productId: p.productId,
          warehouseId,
          type: StockMovementType.OPENING,
          qtyBase: p.qtyBase,
          unitCost: p.unitCost,
          refType: 'IMPORT',
          refId: job.id,
          note: `Import ${job.fileName}`.slice(0, 255),
        })),
      );
    }
    return { created: 0, updated: 0, opening: plans.length };
  }

  private async writeClients(tx: Tx, job: ImportJob, plans: ClientPlan[], user: CurrentUserInfo) {
    const creates = plans.flatMap((p) => (p.kind === 'CREATE' ? [p] : []));
    const ids = await this.clients.createManyInTx(
      tx,
      creates.map((p) => p.input),
    );
    const openings: { clientId: string; amount: string }[] = creates.flatMap((p, i) =>
      p.opening ? [{ clientId: ids[i] ?? '', amount: p.opening }] : [],
    );
    let updated = 0;
    for (const p of plans) {
      if (p.kind !== 'UPDATE') continue;
      if (p.input) {
        await this.clients.updateInTx(tx, p.id, p.input, user);
        updated++;
      }
      if (p.opening) openings.push({ clientId: p.id, amount: p.opening });
    }
    for (const chunk of chunks(openings)) {
      await this.accounts.post(
        tx,
        chunk.map((o) => ({
          clientId: o.clientId,
          type: 'OPENING',
          amount: o.amount,
          label: 'Solde initial (import)',
          refType: 'IMPORT',
          refId: job.id,
        })),
      );
    }
    return { created: creates.length, updated, opening: openings.length };
  }

  // ---------------------------------------------------------------- helpers

  private async lockJob(tx: Tx, id: string): Promise<ImportJob> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM import_jobs
      WHERE id = ${id}::uuid AND "tenantId" = ${tenantContext.requireTenantId()}::uuid
      FOR UPDATE`;
    if (rows.length === 0) throw new AppException(ErrorCode.NOT_FOUND, 'Import not found');
    return tx.importJob.findUniqueOrThrow({ where: { id } });
  }

  /** Records why a confirm failed. Never hides the original error. */
  private async markFailed(id: string, err: unknown): Promise<void> {
    if (!(err instanceof AppException)) return;
    const body = err.getResponse() as { code: string; message: string; details?: unknown };
    if (body.code === ErrorCode.NOT_FOUND || body.code === ErrorCode.IMPORT_NOT_PENDING) return;
    if (body.code === ErrorCode.IDEMPOTENCY_REQUEST_IN_PROGRESS) return;
    const rows =
      body.code === ErrorCode.IMPORT_HAS_ERRORS
        ? ((body.details as { rows?: unknown[] } | undefined)?.rows ?? [])
        : [{ rowNumber: null, errors: [{ code: body.code, params: body.details ?? null }] }];
    await this.prisma.db.importJob
      .updateMany({
        where: { id, status: ImportStatus.PREVIEWED },
        data: {
          status: ImportStatus.FAILED,
          errorRows: Array.isArray(rows) ? rows.length : 0,
          errors: JSON.parse(JSON.stringify(rows)) as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined);
  }
}

/** Keeps known fields only, drops indexes outside the header, every field present. */
function cleanMapping(
  mapping: ImportMapping,
  fields: ImportFieldDef[],
  table: ImportTable,
): ImportMapping {
  const out: ImportMapping = {};
  const width = Math.max(table.headers.length, ...table.rows.map((r) => r.cells.length));
  for (const f of fields) {
    const index = mapping[f.key];
    out[f.key] =
      index !== null && index !== undefined && index >= 0 && index < width ? index : null;
  }
  return out;
}

function columnValues(table: ImportTable, mapping: ImportMapping, key: string): string[] {
  const index = mapping[key];
  if (index === null || index === undefined) return [];
  return table.rows.map((r) => cellText(r.cells[index])).filter((v) => v !== '');
}

function rowDto(r: ValidatedRow<AnyPlan>): ImportRowDto {
  const plan = r.plan;
  if (!plan) return r.row.toDto(null);
  if (!('kind' in plan)) return r.row.toDto('OPENING');
  return r.row.toDto(plan.kind);
}

function countRows(rows: ValidatedRow<AnyPlan>[]): ImportCounts {
  const counts: ImportCounts = {
    total: rows.length,
    valid: 0,
    errors: 0,
    warnings: 0,
    creates: 0,
    updates: 0,
  };
  for (const r of rows) {
    if (r.row.errors.length > 0) counts.errors++;
    else counts.valid++;
    if (r.row.warnings.length > 0) counts.warnings++;
    if (r.plan && 'kind' in r.plan) {
      if (r.plan.kind === 'CREATE') counts.creates++;
      else counts.updates++;
    }
  }
  return counts;
}

function storedErrors(v: Validation): Prisma.InputJsonValue {
  const rows = v.rows
    .filter((r) => r.row.errors.length > 0)
    .slice(0, STORED_ERRORS)
    .map((r) => ({ rowNumber: r.row.rowNumber, errors: r.row.errors }));
  return JSON.parse(
    JSON.stringify([...v.fileErrors.map((e) => ({ rowNumber: null, errors: [e] })), ...rows]),
  ) as Prisma.InputJsonValue;
}
