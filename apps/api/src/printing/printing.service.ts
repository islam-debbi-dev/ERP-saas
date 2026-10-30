import { Injectable } from '@nestjs/common';
import {
  DocType,
  ErrorCode,
  OrderStatus,
  type PrintableDocType,
  type PrintFormat,
  PurchaseStatus,
  StockTransferStatus,
  SaleStatus,
  SaleType,
  type StatementQuery,
  type SupplierStatementQuery,
  ShareDocType,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { ClientsService } from '../clients/clients.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { PurchasesService } from '../purchases/purchases.service';
import { SuppliersService } from '../purchases/suppliers.service';
import { SalesService } from '../sales/sales.service';
import { StockTransfersService } from '../stock/stock-transfers.service';
import { TenantsService } from '../tenants/tenants.service';
import { OrdersService } from '../tournees/orders.service';
import {
  avoirDocument,
  orderDocument,
  type PrintContext,
  purchaseDocument,
  transferDocument,
  receiptDocument,
  saleDocument,
  statementDocument,
  supplierStatementDocument,
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
    private readonly suppliers: SuppliersService,
    private readonly transfers: StockTransfersService,
    private readonly orders: OrdersService,
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
      const sale = await this.sales.get(await this.sales.saleIdOfReturn(id), user);
      const duplicate = await this.recordPrint(DocType.AV, id, fmt, user);
      const number = sale.returns.find((r) => r.id === id)?.number ?? null;
      return done(avoirDocument(sale, id, ctx(duplicate)), number);
    }
    if (type === DocType.TR) {
      const transfer = await this.transfers.get(id);
      if (transfer.status === StockTransferStatus.DRAFT) {
        throw new AppException(ErrorCode.TRANSFER_NOT_VALIDATED, 'A draft transfer is not printed');
      }
      const duplicate = await this.recordPrint(DocType.TR, id, fmt, user);
      return done(transferDocument(transfer, ctx(duplicate)), transfer.number);
    }
    if (type === DocType.BC) {
      const order = await this.orders.get(id, user);
      if (order.status === OrderStatus.DRAFT) {
        throw new AppException(ErrorCode.ORDER_NOT_CONFIRMED, 'A draft order is not printed');
      }
      const duplicate = await this.recordPrint(DocType.BC, id, fmt, user);
      return done(orderDocument(order, ctx(duplicate)), order.number);
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
    const sale = await this.sales.get(id, user);
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

  /** 404 unless the user may read this facture or this client's relevé (phase 14 scope). */
  async assertShareable(
    docType: ShareDocType,
    docId: string,
    user: CurrentUserInfo,
  ): Promise<void> {
    if (docType === ShareDocType.FACTURE) await this.sales.get(docId, user);
    else await this.clients.get(docId, user);
  }

  async receipt(
    id: string,
    format: PrintFormat | undefined,
    user: CurrentUserInfo,
  ): Promise<PreparedDocument> {
    const seller = await this.tenants.getSettings();
    const fmt = format ?? seller.defaultPrintFormat;
    const payment = await this.payments.get(id, user);
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
    user?: CurrentUserInfo,
  ): Promise<PreparedDocument> {
    const seller = await this.tenants.getSettings();
    const fmt = format ?? seller.defaultPrintFormat;
    const client = await this.clients.get(clientId, user);
    const statement = await this.clients.statement(clientId, query, user);
    return {
      html: statementDocument(statement, client, { seller, format: fmt }),
      format: fmt,
      filename: `releve-${client.code}-${query.from}-${query.to}.pdf`,
      footer: seller.documentFooter,
    };
  }

  /** Relevé fournisseur (phase 21): a report of the account, never a duplicata. */
  async supplierStatement(
    supplierId: string,
    query: SupplierStatementQuery,
    format: PrintFormat | undefined,
  ): Promise<PreparedDocument> {
    const seller = await this.tenants.getSettings();
    const fmt = format ?? seller.defaultPrintFormat;
    const supplier = await this.suppliers.get(supplierId);
    const statement = await this.suppliers.statement(supplierId, query);
    return {
      html: supplierStatementDocument(statement, supplier, { seller, format: fmt }),
      format: fmt,
      filename: `releve-fournisseur-${supplier.code ?? supplier.id.slice(0, 8)}-${query.from}-${query.to}.pdf`,
      footer: seller.documentFooter,
    };
  }

  /**
   * A facture opened through a share link (phase 21). Not a print: nothing is added to
   * the print log, and it is a DUPLICATA once the original was printed.
   */
  async sharedFacture(id: string): Promise<PreparedDocument> {
    const seller = await this.tenants.getSettings();
    const sale = await this.sales.get(id);
    if (sale.type !== SaleType.FACTURE || sale.status === SaleStatus.DRAFT) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Sale not found');
    }
    const printed = await this.prisma.db.documentPrint.count({
      where: { docType: DocType.FAC, docId: id },
    });
    const fmt = seller.defaultPrintFormat;
    return {
      html: saleDocument(sale, { seller, format: fmt, duplicate: printed > 0 }),
      format: fmt,
      filename: `${sale.number ?? 'FAC'}.pdf`,
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
