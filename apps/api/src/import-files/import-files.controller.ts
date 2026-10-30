import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  type AttachPurchaseInput,
  attachPurchaseSchema,
  type CancelImportCostInput,
  cancelImportCostSchema,
  type CreateImportFileInput,
  createImportFileSchema,
  Feature,
  type ImportCostInput,
  importCostSchema,
  type ImportFileDto,
  type ImportFileListQuery,
  importFileListQuerySchema,
  type ImportFilePage,
  type LandedCostPreviewDto,
  Role,
  type UpdateImportFileInput,
  updateImportFileSchema,
} from '@erp/shared';
import { RequireFeature, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Idempotent } from '../idempotency/idempotent.decorator';
import { ImportFilesService } from './import-files.service';

/** Dossiers d'importation (phase 22). Costs and margins: managers only. */
@Controller('import-files')
@RequireFeature(Feature.IMPORT_COSTS)
@Roles(Role.OWNER, Role.MANAGER)
export class ImportFilesController {
  constructor(private readonly files: ImportFilesService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(importFileListQuerySchema)) query: ImportFileListQuery,
  ): Promise<ImportFilePage> {
    return this.files.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ImportFileDto> {
    return this.files.get(id);
  }

  /** The allocation table; writes nothing. */
  @Get(':id/preview')
  preview(@Param('id', ParseUUIDPipe) id: string): Promise<LandedCostPreviewDto> {
    return this.files.preview(id);
  }

  @Post()
  @Idempotent()
  create(
    @Body(new ZodValidationPipe(createImportFileSchema)) body: CreateImportFileInput,
  ): Promise<ImportFileDto> {
    return this.files.create(body);
  }

  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateImportFileSchema)) body: UpdateImportFileInput,
  ): Promise<ImportFileDto> {
    return this.files.update(id, body);
  }

  @Post(':id/cancel')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cancelImportCostSchema)) body: CancelImportCostInput,
  ): Promise<ImportFileDto> {
    return this.files.cancel(id, body.reason);
  }

  @Post(':id/purchases')
  @HttpCode(HttpStatus.OK)
  attach(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(attachPurchaseSchema)) body: AttachPurchaseInput,
  ): Promise<ImportFileDto> {
    return this.files.attach(id, body);
  }

  @Delete(':id/purchases/:purchaseId')
  detach(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('purchaseId', ParseUUIDPipe) purchaseId: string,
  ): Promise<ImportFileDto> {
    return this.files.detach(id, purchaseId);
  }

  @Post(':id/costs')
  @Idempotent()
  addCost(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(importCostSchema)) body: ImportCostInput,
  ): Promise<ImportFileDto> {
    return this.files.addCost(id, body);
  }

  @Post(':id/costs/:costId/cancel')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  cancelCost(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('costId', ParseUUIDPipe) costId: string,
    @Body(new ZodValidationPipe(cancelImportCostSchema)) body: CancelImportCostInput,
  ): Promise<ImportFileDto> {
    return this.files.cancelCost(id, costId, body.reason);
  }

  @Post(':id/close')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  close(@Param('id', ParseUUIDPipe) id: string): Promise<ImportFileDto> {
    return this.files.close(id);
  }

  @Post(':id/late-cost')
  @Idempotent()
  lateCost(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(importCostSchema)) body: ImportCostInput,
  ): Promise<ImportFileDto> {
    return this.files.lateCost(id, body);
  }
}
