import { Controller, Get, Param, ParseUUIDPipe, Query, StreamableFile } from '@nestjs/common';
import {
  type PrintableDocType,
  printableDocTypeSchema,
  type PrintQuery,
  printQuerySchema,
  type StatementPdfQuery,
  statementPdfQuerySchema,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PdfRendererService } from './pdf-renderer.service';
import { type PreparedDocument, PrintingService } from './printing.service';

async function pdf(renderer: PdfRendererService, doc: PreparedDocument): Promise<StreamableFile> {
  const buffer = await renderer.render(doc.html, doc.format, doc.footer);
  return new StreamableFile(buffer, {
    type: 'application/pdf',
    // inline: the browser shows it in a tab, where the user prints or saves it.
    disposition: `inline; filename="${doc.filename}"`,
    length: buffer.length,
  });
}

@Controller('documents')
export class DocumentsPrintController {
  constructor(
    private readonly printing: PrintingService,
    private readonly renderer: PdfRendererService,
  ) {}

  @Get(':type/:id/pdf')
  async document(
    @Param('type', new ZodValidationPipe(printableDocTypeSchema)) type: PrintableDocType,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(printQuerySchema)) query: PrintQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StreamableFile> {
    return pdf(this.renderer, await this.printing.document(type, id, query.format, user));
  }
}

@Controller('clients')
export class StatementPrintController {
  constructor(
    private readonly printing: PrintingService,
    private readonly renderer: PdfRendererService,
  ) {}

  @Get(':id/statement/pdf')
  async statement(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(statementPdfQuerySchema)) query: StatementPdfQuery,
  ): Promise<StreamableFile> {
    const { format, ...range } = query;
    return pdf(this.renderer, await this.printing.statement(id, range, format));
  }
}

@Controller('payments')
export class ReceiptPrintController {
  constructor(
    private readonly printing: PrintingService,
    private readonly renderer: PdfRendererService,
  ) {}

  @Get(':id/receipt.pdf')
  async receipt(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(printQuerySchema)) query: PrintQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StreamableFile> {
    return pdf(this.renderer, await this.printing.receipt(id, query.format, user));
  }
}
