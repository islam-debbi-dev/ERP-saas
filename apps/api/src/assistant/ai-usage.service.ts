import { Injectable } from '@nestjs/common';
import type { AiUsageDto, AiUsageRowDto } from '@erp/shared';
import { money } from '@erp/shared';
import { algiersMidnight } from '../common/algiers';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const BAD_ANSWERS = 50;

function nextMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, '0')}`;
}

/** Super-admin usage page (phase 30): every company, so always in the system context. */
@Injectable()
export class AiUsageService {
  constructor(private readonly prisma: PrismaService) {}

  usage(month: string): Promise<AiUsageDto> {
    const start = algiersMidnight(`${month}-01`);
    const end = algiersMidnight(`${nextMonth(month)}-01`);
    return tenantContext.runAsSystem(async () => {
      const rows = await this.prisma.db.$queryRaw<
        {
          tenantId: string;
          tenantName: string;
          provider: AiUsageRowDto['provider'];
          model: string;
          configScope: AiUsageRowDto['configScope'];
          questions: bigint;
          inputTokens: bigint;
          cachedTokens: bigint;
          outputTokens: bigint;
          costMicroUsd: Prisma.Decimal;
          useful: bigint;
          notUseful: bigint;
        }[]
      >(Prisma.sql`
        SELECT m."tenantId", t.name AS "tenantName", m.provider, m.model, m."configScope",
          COUNT(*) FILTER (WHERE m.role = 'USER') AS questions,
          COALESCE(SUM(m."inputTokens"), 0) AS "inputTokens",
          COALESCE(SUM(m."cachedTokens"), 0) AS "cachedTokens",
          COALESCE(SUM(m."outputTokens"), 0) AS "outputTokens",
          COALESCE(SUM(m."costMicroUsd"), 0) AS "costMicroUsd",
          COUNT(*) FILTER (WHERE m.useful) AS useful,
          COUNT(*) FILTER (WHERE m.useful = false) AS "notUseful"
        FROM assistant_messages m JOIN tenants t ON t.id = m."tenantId"
        WHERE m."createdAt" >= ${start} AND m."createdAt" < ${end} AND m.provider IS NOT NULL
        GROUP BY m."tenantId", t.name, m.provider, m.model, m."configScope"
        ORDER BY "costMicroUsd" DESC, t.name`);

      const bad = await this.prisma.db.assistantMessage.findMany({
        where: { useful: false, createdAt: { gte: start, lt: end } },
        orderBy: { seq: 'desc' },
        take: BAD_ANSWERS,
        include: { tenant: { select: { name: true } } },
      });
      const questions = await Promise.all(
        bad.map((answer) =>
          this.prisma.db.assistantMessage.findFirst({
            where: { conversationId: answer.conversationId, role: 'USER', seq: { lt: answer.seq } },
            orderBy: { seq: 'desc' },
            select: { content: true },
          }),
        ),
      );

      return {
        month,
        rows: rows.map((r) => ({
          tenantId: r.tenantId,
          tenantName: r.tenantName,
          provider: r.provider,
          model: r.model,
          configScope: r.configScope,
          questions: Number(r.questions),
          inputTokens: Number(r.inputTokens),
          cachedTokens: Number(r.cachedTokens),
          outputTokens: Number(r.outputTokens),
          costUsd: money(r.costMicroUsd.toString()).div(1_000_000).toFixed(6),
          useful: Number(r.useful),
          notUseful: Number(r.notUseful),
        })),
        badAnswers: bad.map((answer, i) => ({
          id: answer.id,
          tenantName: answer.tenant.name,
          question: questions[i]?.content ?? '',
          answer: answer.content,
          comment: answer.feedbackComment,
          createdAt: answer.createdAt.toISOString(),
        })),
      };
    });
  }
}
