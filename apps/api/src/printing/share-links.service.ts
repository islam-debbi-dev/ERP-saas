import { Inject, Injectable } from '@nestjs/common';
import {
  addDays,
  type CreateShareLinkInput,
  ErrorCode,
  SaleStatus,
  SaleType,
  SHARE_LINK_TTL_DAYS,
  ShareDocType,
  type ShareLinkDto,
  type StatementQuery,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { type PreparedDocument, PrintingService } from './printing.service';
import { hashShareToken, isShareLinkUsable, newShareToken } from './share-token';

const DAY_MS = 86_400_000;

/**
 * Signed, expiring links to a relevé or a facture (phase 21), opened without login, for
 * WhatsApp. Only the token's SHA-256 is stored; a link is revocable and each opening is
 * counted and audited. Unknown, expired and revoked tokens get the same answer.
 */
@Injectable()
export class ShareLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly printing: PrintingService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(input: CreateShareLinkInput, user: CurrentUserInfo): Promise<ShareLinkDto> {
    await this.checkDocument(input);
    const { token, hash } = newShareToken();
    const expiresAt = new Date(Date.now() + SHARE_LINK_TTL_DAYS * DAY_MS);
    const params = input.docType === ShareDocType.RELEVE ? { from: input.from, to: input.to } : {};
    const link = await this.prisma.db.$transaction(async (tx) => {
      const created = await tx.shareLink.create({
        data: {
          tenantId: tenantContext.requireTenantId(),
          docType: input.docType,
          docId: input.docId,
          params,
          tokenHash: hash,
          expiresAt,
          createdBy: user.id,
        },
      });
      await this.audit.log(tx, {
        action: 'SHARE_LINK_CREATED',
        entity: 'ShareLink',
        entityId: created.id,
        after: { docType: input.docType, docId: input.docId, params, expiresAt },
      });
      return created;
    });
    const origin = this.config.WEB_ORIGIN.split(',')[0]?.trim() ?? '';
    return { id: link.id, url: `${origin}/s/${token}`, expiresAt: link.expiresAt.toISOString() };
  }

  async revoke(id: string, user: CurrentUserInfo): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const link = await tx.shareLink.findUnique({ where: { id } });
      if (!link) throw new AppException(ErrorCode.NOT_FOUND, 'Share link not found');
      if (link.revokedAt) return;
      await tx.shareLink.update({
        where: { id },
        data: { revokedAt: new Date(), revokedBy: user.id },
      });
      await this.audit.log(tx, {
        action: 'SHARE_LINK_REVOKED',
        entity: 'ShareLink',
        entityId: id,
        before: { expiresAt: link.expiresAt },
      });
    });
  }

  /** Public: the token is the only credential. The document is rendered in its tenant. */
  async open(token: string): Promise<PreparedDocument> {
    const link = /^[A-Za-z0-9_-]{20,100}$/.test(token)
      ? await tenantContext.runAsSystem(() =>
          this.prisma.db.shareLink.findUnique({ where: { tokenHash: hashShareToken(token) } }),
        )
      : null;
    if (!link || !isShareLinkUsable(link)) {
      throw new AppException(ErrorCode.SHARE_LINK_INVALID, 'This link is invalid or has expired');
    }
    const ctx = tenantContext.get();
    return tenantContext.run({ ...ctx, tenantId: link.tenantId, system: false }, async () => {
      const doc =
        link.docType === ShareDocType.FACTURE
          ? await this.printing.sharedFacture(link.docId)
          : await this.printing.statement(link.docId, link.params as StatementQuery, undefined);
      await this.prisma.db.$transaction(async (tx) => {
        await tx.shareLink.update({
          where: { id: link.id },
          data: { openCount: { increment: 1 }, lastOpenedAt: new Date() },
        });
        await this.audit.log(tx, {
          action: 'SHARE_LINK_OPENED',
          entity: 'ShareLink',
          entityId: link.id,
          userId: null,
          after: { docType: link.docType, docId: link.docId, userAgent: ctx?.userAgent ?? null },
        });
      });
      return doc;
    });
  }

  private async checkDocument(input: CreateShareLinkInput): Promise<void> {
    if (input.docType === ShareDocType.FACTURE) {
      const sale = await this.prisma.db.sale.findUnique({
        where: { id: input.docId },
        select: { type: true, status: true },
      });
      if (!sale || sale.type !== SaleType.FACTURE || sale.status !== SaleStatus.VALIDATED) {
        throw new AppException(ErrorCode.NOT_FOUND, 'Facture not found');
      }
      return;
    }
    const client = await this.prisma.db.client.findUnique({
      where: { id: input.docId },
      select: { id: true },
    });
    if (!client) throw new AppException(ErrorCode.NOT_FOUND, 'Client not found');
    // A relevé shows at most a year, like a statement asked in the app.
    if (input.from < addDays(input.to, -366)) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Period too long', {
        field: 'from',
        rule: 'range_too_long',
      });
    }
  }
}
