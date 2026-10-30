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
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  type CreateShareLinkInput,
  createShareLinkSchema,
  type PrintableDocType,
  printableDocTypeSchema,
  type PrintQuery,
  printQuerySchema,
  Role,
  type ShareLinkDto,
  type StatementPdfQuery,
  statementPdfQuerySchema,
  supplierStatementQuerySchema,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, Public, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PdfRendererService } from './pdf-renderer.service';
import { type PreparedDocument, PrintingService } from './printing.service';
import { ShareLinksService } from './share-links.service';

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
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StreamableFile> {
    const { format, ...range } = query;
    return pdf(this.renderer, await this.printing.statement(id, range, format, user));
  }

  /** Relevé d'emballages (phase 20); readable when the module is off. */
  @Get(':id/packaging/pdf')
  async packagingStatement(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(printQuerySchema)) query: PrintQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StreamableFile> {
    return pdf(this.renderer, await this.printing.packagingStatement(id, query.format, user));
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

const supplierStatementPdfQuerySchema = supplierStatementQuerySchema.and(printQuerySchema);

@Controller('suppliers')
export class SupplierStatementPrintController {
  constructor(
    private readonly printing: PrintingService,
    private readonly renderer: PdfRendererService,
  ) {}

  @Get(':id/statement/pdf')
  @Roles(Role.OWNER, Role.MANAGER)
  async statement(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(supplierStatementPdfQuerySchema)) query: StatementPdfQuery,
  ): Promise<StreamableFile> {
    const { format, ...range } = query;
    return pdf(this.renderer, await this.printing.supplierStatement(id, range, format));
  }
}

/** Share links (phase 21). Storekeepers do not send documents to clients. */
@Controller('share-links')
@Roles(Role.OWNER, Role.MANAGER, Role.SELLER)
export class ShareLinksController {
  constructor(private readonly links: ShareLinksService) {}

  @Post()
  create(
    @Body(new ZodValidationPipe(createShareLinkSchema)) body: CreateShareLinkInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<ShareLinkDto> {
    return this.links.create(body, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<void> {
    return this.links.revoke(id, user);
  }
}

/** The public side of a share link: no login, the token is the credential. */
@Controller('s')
export class PublicShareController {
  constructor(
    private readonly links: ShareLinksService,
    private readonly renderer: PdfRendererService,
  ) {}

  @Get(':token')
  @Public()
  async open(@Param('token') token: string): Promise<StreamableFile> {
    return pdf(this.renderer, await this.links.open(token));
  }
}
