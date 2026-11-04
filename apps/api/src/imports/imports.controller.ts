import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  IMPORT_MAX_FILE_BYTES,
  type ImportJobDto,
  type ImportJobPage,
  type ImportListQuery,
  importListQuerySchema,
  type ImportPreviewBody,
  importPreviewBodySchema,
  type ImportPreviewDto,
  type ImportType,
  importTypeSchema,
  Role,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Idempotent } from '../idempotency/idempotent.decorator';
import { ImportsService, type UploadedImportFile } from './imports.service';
import { buildTemplate, TEMPLATE_FILE_NAMES } from './templates';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Imports change master data, stock and client accounts: managers only. */
@Controller('imports')
@Roles(Role.OWNER, Role.MANAGER)
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(importListQuerySchema)) query: ImportListQuery,
  ): Promise<ImportJobPage> {
    return this.imports.list(query);
  }

  @Get('templates/:type')
  async template(
    @Param('type', new ZodValidationPipe(importTypeSchema)) type: ImportType,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StreamableFile> {
    await this.imports.assertTypeAllowed(type, user);
    const buffer = await buildTemplate(type, await this.imports.priceLevels());
    return new StreamableFile(buffer, {
      type: XLSX_MIME,
      disposition: `attachment; filename="${TEMPLATE_FILE_NAMES[type]}"`,
      length: buffer.length,
    });
  }

  /** Validates every row and stores the job; writes no business data. */
  @Post(':type/preview')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_FILE_BYTES, files: 1 } }),
  )
  preview(
    @Param('type', new ZodValidationPipe(importTypeSchema)) type: ImportType,
    @UploadedFile() file: UploadedImportFile | undefined,
    @Body(new ZodValidationPipe(importPreviewBodySchema)) body: ImportPreviewBody,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<ImportPreviewDto> {
    return this.imports.preview(type, { file, jobId: body.jobId, mapping: body.mapping }, user);
  }

  @Post(':id/confirm')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<ImportJobDto> {
    return this.imports.confirm(id, user);
  }
}
