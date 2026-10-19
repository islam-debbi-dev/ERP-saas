import { Injectable } from '@nestjs/common';
import {
  DocType,
  ErrorCode,
  type PrintableDocType,
  type PrintFormat,
  PurchaseStatus,
  SaleStatus,
  SaleType,
  type StatementQuery,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { ClientsService } from '../clients/clients.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { PurchasesService } from '../purchases/purchases.service';
import { SalesService } from '../sales/sales.service';
import { TenantsService } from '../tenants/tenants.service';
import {
  avoirDocument,
  type PrintContext,
  purchaseDocument,
  receiptDocument,
  saleDocument,
  statementDocument,
} from './templates/documents';

/** A document ready to be turned into a PDF. */
export interface PreparedDocument {
  html: string;
  format: PrintFormat;
  filename: string;
  /** Tenant footer text, printed at the bottom of every page. */
  footer: string | null;
}

const SALE_TYPE_OF: Partial<Record<PrintableDocType, SaleType>> = {
  BL: SaleType.BL,
  FAC: SaleType.FACTURE,
};

/**
 * Builds printed documents from the frozen data the owning modules return
 * (SalesService, PurchasesService, PaymentsService, ClientsService) and logs each
 * print: the first print of a document is the original, later ones are DUPLICATA.
 */
@Injectable()
export class PrintingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenants: TenantsService,
    private readonly sales: SalesService,
    private readonly purchases: PurchasesService,
    private readonly payments: PaymentsService,
    private readonly clients: ClientsService,
  ) {}

  async document(
    type: PrintableDocType,
    id: string,
    format: PrintFormat | undefined,
    user: CurrentUserInfo,
  ): Promise<PreparedDocument> {
    const seller = await this.tenants.getSettings();
    const fmt = format ?? seller.defaultPrintFormat;
    const ctx = (duplicate: boolean): PrintContext => ({ seller, format: fmt, duplicate });
    const done = (html: string, number: string | null): PreparedDocument => ({
      html,
      format: fmt,
      filename: `${number ?? type}.pdf`,
      footer: seller.documentFooter,
    });

    if (type === DocType.AV) {
      const sale = await this.sales.get(await this.sales.saleIdOfReturn(id));
      const duplicate = await this.recordPrint(DocType.AV, id, fmt, user);
      const number = sale.returns.find((r) => r.id === id)?.number ?? null;
      return done(avoirDocument(sale, id, ctx(duplicate)), number);
    }
    if (type === DocType.BR) {
      const purchase = await this.purchases.get(id);
      if (purchase.status === PurchaseStatus.DRAFT) {
        throw new AppException(
          ErrorCode.PURCHASE_NOT_VALIDATED,
          'A draft bon de réception is not printed',
        );
      }
      const duplicate = await this.recordPrint(DocType.BR, id, fmt, user);
      return done(purchaseDocument(purchase, ctx(duplicate)), purchase.number);
    }
    const sale = await this.sales.get(id);
    // /documents/BL/<facture id> is a wrong link, not another way to print it.
    if (sale.type !== SALE_TYPE_OF[type]) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Sale not found');
    }
    if (sale.status === SaleStatus.DRAFT) {
      throw new AppException(ErrorCode.SALE_NOT_VALIDATED, 'A draft is not printed');
    }
    const duplicate = await this.recordPrint(type, id, fmt, user);
    return done(saleDocument(sale, ctx(duplicate)), sale.number);
  }

  async receipt(
    id: string,
    format: PrintFormat | undefined,
    user: CurrentUserInfo,
  ): Promise<PreparedDocument> {
    const seller = await this.tenants.getSettings();
    const fmt = format ?? seller.defaultPrintFormat;
    const payment = await this.payments.get(id);
    const duplicate = await this.recordPrint(DocType.VER, id, fmt, user);
    return {
      html: receiptDocument(payment, { seller, format: fmt, duplicate }),
      format: fmt,
      filename: `${payment.number}.pdf`,
      footer: seller.documentFooter,
    };
  }

  /** The relevé is a report of the account as it is now: never a duplicata. */
  async statement(
    clientId: string,
    query: StatementQuery,
    format: PrintFormat | undefined,
  ): Promise<PreparedDocument> {
    const seller = await this.tenants.getSettings();
    const fmt = format ?? seller.defaultPrintFormat;
    const client = await this.clients.get(clientId);
    const statement = await this.clients.statement(clientId, query);
    return {
      html: statementDocument(statement, client, { seller, format: fmt }),
      format: fmt,
      filename: `releve-${client.code}-${query.from}-${query.to}.pdf`,
      footer: seller.documentFooter,
    };
  }

  /**
   * Appends to the print log and says whether this print is a duplicata. Prints
   * of one document are serialized by a transaction-scoped advisory lock, so two
   * simultaneous first prints cannot both be the original.
   */
  private recordPrint(
    docType: DocType,
    docId: string,
    format: PrintFormat,
    user: CurrentUserInfo,
  ): Promise<boolean> {
    const tenantId = tenantContext.requireTenantId();
    return this.prisma.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${docId}, 0))`;
      const earlier = await tx.documentPrint.count({ where: { docType, docId } });
      await tx.documentPrint.create({
        data: { tenantId, docType, docId, format, printedBy: user.id },
      });
      await this.audit.log(tx, {
        action: 'DOCUMENT_PRINTED',
        entity: docType,
        entityId: docId,
        after: { format, duplicate: earlier > 0 },
      });
      return earlier > 0;
    });
  }
}
