'use client';

import { useTranslations } from 'next-intl';
import { PayLineCode, type PayslipDto, type PayslipLineDto } from '@erp/shared';
import { Amount } from '@/components/shared/amount';

/** These carry a name the company chose or typed: shown as frozen, never translated. */
const OWN_LABEL: readonly PayLineCode[] = [
  PayLineCode.ITEM,
  PayLineCode.INCENTIVE,
  PayLineCode.REGULARISATION,
  PayLineCode.RETENUE,
];

function Line({ line }: { line: PayslipLineDto }) {
  const t = useTranslations('payroll');
  const label = OWN_LABEL.includes(line.code) ? line.label : t(`line_${line.code}`);
  const how =
    line.quantity && line.base
      ? `${line.quantity} × ${line.base}`
      : line.base && line.rate
        ? `${line.base} × ${line.rate}`
        : null;
  return (
    <li className="flex items-start justify-between gap-3 py-1.5">
      <span className="min-w-0">
        <span className="block break-words">{label}</span>
        {how ? (
          <bdi dir="ltr" className="num block text-xs text-muted-foreground">
            {how}
          </bdi>
        ) : null}
      </span>
      <Amount value={line.amount} className="shrink-0" />
    </li>
  );
}

function Total({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={strong ? 'flex justify-between gap-3 font-semibold' : 'flex justify-between gap-3'}
    >
      <dt className="min-w-0">{label}</dt>
      <dd>
        <Amount value={value} />
      </dd>
    </div>
  );
}

/** Each line of a payslip with how it was reached, then the totals. */
export function PayslipLines({ slip }: { slip: PayslipDto }) {
  const t = useTranslations('payroll');
  return (
    <div className="space-y-3 text-sm">
      <ul className="divide-y">
        {slip.lines.map((l, i) => (
          <Line key={`${l.code}-${i}`} line={l} />
        ))}
      </ul>
      <dl className="space-y-1 border-t pt-2">
        <Total label={t('gross')} value={slip.gross} />
        {slip.declared ? <Total label={t('cotisable')} value={slip.cotisable} /> : null}
        {slip.declared ? <Total label={t('taxable')} value={slip.taxable} /> : null}
        {slip.declared ? <Total label={t('employerCnas')} value={slip.cnasEmployer} /> : null}
        <Total label={t('net')} value={slip.net} />
        <Total label={t('netToPay')} value={slip.netToPay} strong />
      </dl>
      {slip.advanceCarried !== '0.00' ? (
        <p className="text-muted-foreground">
          {t('advanceCarried')} <Amount value={slip.advanceCarried} />
        </p>
      ) : null}
    </div>
  );
}
