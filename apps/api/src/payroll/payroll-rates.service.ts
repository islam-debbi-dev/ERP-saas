import { Injectable } from '@nestjs/common';
import {
  type CompanyRateSetInput,
  ErrorCode,
  type PayrollRatesDto,
  PayrollRateDecision,
  RATE_CONFIRMATION_TEXTS,
  type RateDecisionInput,
  type RateTextLocale,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { fromDay, toDay } from '../hr/attendance-days.service';
import { rateSetDto } from './rate-set.dto';

type Row = Prisma.PayrollRateSetGetPayload<object>;

const NEWEST_FIRST = [{ effectiveFrom: 'desc' }, { seq: 'desc' }] as const;

/**
 * The company answers for its rates, not the platform: a run is approved only on a set the
 * owner created or accepted. Sets and confirmations are append-only, and nothing here
 * changes the rates of a company by itself.
 */
@Injectable()
export class PayrollRatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(db: Tx | PrismaService['db'] = this.prisma.db): Promise<PayrollRatesDto> {
    const [sets, answers] = await Promise.all([
      db.payrollRateSet.findMany({ orderBy: [...NEWEST_FIRST] }),
      db.payrollRateConfirmation.findMany({ select: { rateSetId: true, decision: true } }),
    ]);
    const platform = sets.filter((s) => s.tenantId === null);
    const own = sets.filter((s) => s.tenantId !== null);
    const answered = new Set(answers.map((a) => a.rateSetId));
    const confirmed = new Set(
      answers.filter((a) => a.decision === PayrollRateDecision.CONFIRMED).map((a) => a.rateSetId),
    );
    const latest = platform[0];
    const newOfficial =
      latest && own.length > 0 && latest.seq > this.lastSeq(own) && !answered.has(latest.id)
        ? rateSetDto(latest)
        : null;
    return {
      platform: platform.map((s) => ({ ...rateSetDto(s), confirmed: confirmed.has(s.id) })),
      own: own.map(rateSetDto),
      newOfficial,
    };
  }

  private lastSeq(rows: Row[]): bigint {
    return rows.reduce((max, r) => (r.seq > max ? r.seq : max), 0n);
  }

  /** The company's own set. The box "validés par mon comptable" is its confirmation. */
  async create(input: CompanyRateSetInput, user: CurrentUserInfo): Promise<PayrollRatesDto> {
    const { locale, confirmed: _confirmed, ...values } = input;
    return this.prisma.db.$transaction(async (tx) => {
      const before = await this.inForce(tx, input.effectiveFrom);
      const row = await this.insert(tx, {
        ...values,
        irgBrackets: values.irgBrackets,
        effectiveFrom: fromDay(values.effectiveFrom),
      });
      await this.confirm(tx, row.id, RATE_CONFIRMATION_TEXTS.OWN[locale], locale, user);
      await this.audit.log(tx, {
        action: 'PAYROLL_RATE_SET_CREATED',
        entity: 'PayrollRateSet',
        entityId: row.id,
        before: before ? rateSetDto(before) : null,
        after: rateSetDto(row),
      });
      return this.list(tx);
    });
  }

  /**
   * "Oui, ces taux." Without rates of its own the company confirms the set as it is. With
   * them, a newer platform set takes effect through a copy of its values: a company's own
   * set always wins, so this is the one way to move to the official rates.
   */
  async accept(
    id: string,
    { locale }: RateDecisionInput,
    user: CurrentUserInfo,
  ): Promise<PayrollRatesDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const set = await this.platformSet(tx, id);
      const own = await tx.payrollRateSet.findMany({
        where: { tenantId: tenantContext.requireTenantId() },
        orderBy: [...NEWEST_FIRST],
      });
      const text = RATE_CONFIRMATION_TEXTS.ACCEPT[locale];
      await this.confirm(tx, set.id, text, locale, user);
      let copy: Row | null = null;
      if (own[0] && set.seq > this.lastSeq(own)) {
        const { id: _id, seq: _seq, tenantId: _t, createdAt: _c, ...values } = set;
        const from = toDay(set.effectiveFrom);
        const last = toDay(own[0].effectiveFrom);
        copy = await this.insert(tx, {
          ...values,
          irgBrackets: set.irgBrackets as Prisma.InputJsonValue,
          // From a date at least as late as its own sets, or it would never apply.
          effectiveFrom: fromDay(from > last ? from : last),
          note: `Copie des taux officiels du ${from}`,
        });
        await this.confirm(tx, copy.id, text, locale, user);
      }
      await this.audit.log(tx, {
        action: 'PAYROLL_RATES_ACCEPTED',
        entity: 'PayrollRateSet',
        entityId: copy?.id ?? set.id,
        before: own[0] ? rateSetDto(own[0]) : null,
        after: rateSetDto(copy ?? set),
      });
      return this.list(tx);
    });
  }

  /** Answers the banner: the company stays on its set, and nothing changes. */
  async keepOwn(
    id: string,
    { locale }: RateDecisionInput,
    user: CurrentUserInfo,
  ): Promise<PayrollRatesDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const set = await this.platformSet(tx, id);
      await this.record(
        tx,
        set.id,
        PayrollRateDecision.KEPT_OWN,
        RATE_CONFIRMATION_TEXTS.KEEP[locale],
        locale,
        user,
      );
      await this.audit.log(tx, {
        action: 'PAYROLL_RATES_KEPT',
        entity: 'PayrollRateSet',
        entityId: set.id,
        after: { effectiveFrom: toDay(set.effectiveFrom) },
      });
      return this.list(tx);
    });
  }

  async assertConfirmed(tx: Tx, rateSetId: string): Promise<void> {
    if ((await this.confirmedIds(tx, [rateSetId])).size > 0) return;
    throw new AppException(
      ErrorCode.PAYROLL_RATES_NOT_CONFIRMED,
      'The owner has not confirmed the rates of this run',
      { rateSetId },
    );
  }

  async confirmedIds(tx: Tx, rateSetIds: string[]): Promise<Set<string>> {
    const rows = await tx.payrollRateConfirmation.findMany({
      where: {
        rateSetId: { in: [...new Set(rateSetIds)] },
        decision: PayrollRateDecision.CONFIRMED,
      },
      select: { rateSetId: true },
    });
    return new Set(rows.map((r) => r.rateSetId));
  }

  private async platformSet(tx: Tx, id: string): Promise<Row> {
    const set = await tx.payrollRateSet.findFirst({ where: { id, tenantId: null } });
    if (!set) throw new AppException(ErrorCode.NOT_FOUND, 'Rate set not found');
    return set;
  }

  /** What the company would use on that day, for the audit's "before". */
  private async inForce(tx: Tx, day: string): Promise<Row | null> {
    const rows = await tx.payrollRateSet.findMany({
      where: { effectiveFrom: { lte: fromDay(day) } },
      orderBy: [...NEWEST_FIRST],
    });
    return rows.find((r) => r.tenantId !== null) ?? rows[0] ?? null;
  }

  private insert(
    tx: Tx,
    values: Omit<Prisma.PayrollRateSetUncheckedCreateInput, 'tenantId' | 'toVerify'>,
  ): Promise<Row> {
    return tx.payrollRateSet.create({
      data: { ...values, tenantId: tenantContext.requireTenantId(), toVerify: false },
    });
  }

  private confirm(
    tx: Tx,
    rateSetId: string,
    text: string,
    locale: RateTextLocale,
    user: CurrentUserInfo,
  ): Promise<void> {
    return this.record(tx, rateSetId, PayrollRateDecision.CONFIRMED, text, locale, user);
  }

  /** A second answer changes nothing: the first who, when and text stay on record. */
  private async record(
    tx: Tx,
    rateSetId: string,
    decision: PayrollRateDecision,
    text: string,
    locale: RateTextLocale,
    user: CurrentUserInfo,
  ): Promise<void> {
    await tx.payrollRateConfirmation.createMany({
      data: [
        {
          tenantId: tenantContext.requireTenantId(),
          rateSetId,
          decision,
          text,
          locale,
          createdBy: user.id,
        },
      ],
      skipDuplicates: true,
    });
  }
}
