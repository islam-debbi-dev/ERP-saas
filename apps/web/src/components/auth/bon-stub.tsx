import { formatDA, mul, sub, sum } from '@erp/shared';
import { t } from '@/lib/i18n';

const LINES = [
  { label: t('auth.stub.line1'), qty: '10', price: '1250' },
  { label: t('auth.stub.line2'), qty: '8', price: '950' },
  { label: t('auth.stub.line3'), qty: '15', price: '1080' },
] as const;
const PAID = '25000';

/**
 * A delivery note from a carnet à souche, the object every grossiste knows.
 * Decorative: hidden from screen readers.
 */
export function BonStub() {
  const amounts = LINES.map((l) => mul(l.qty, l.price));
  const total = sum(amounts);
  const credit = sub(total, PAID);

  return (
    <figure aria-hidden="true" className="w-full max-w-sm select-none">
      <div className="relative -rotate-[1.5deg] rounded-sm bg-card px-6 pt-7 pb-6 shadow-[0_1px_0_var(--rule),0_12px_32px_-12px_rgb(20_33_61/0.25)]">
        {/* Perforated edge where the bon was torn from the book */}
        <div className="absolute inset-x-0 top-0 h-2 bg-[radial-gradient(circle_at_6px_0,var(--carbon-soft)_4px,transparent_4.5px)] bg-[length:12px_8px]" />
        <div className="flex items-baseline justify-between border-b border-dashed pb-3">
          <span className="font-semibold">{t('auth.stub.title')}</span>
          <span className="font-mono text-sm text-carbon">BL-2026-000148</span>
        </div>
        <p className="mt-3 text-sm">
          <span className="text-muted-foreground">{t('auth.stub.client')} : </span>
          {t('auth.stub.clientName')}
        </p>
        <table className="num mt-4 w-full text-sm">
          <tbody>
            {LINES.map((line, i) => (
              <tr key={line.label} className="border-b border-border/70 align-baseline">
                <td className="py-1.5 pr-2">{line.label}</td>
                <td className="py-1.5 pr-3 text-right text-muted-foreground">{line.qty}</td>
                <td className="py-1.5 text-right">
                  {formatDA(amounts[i] ?? 0, { currency: false })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="num mt-4 space-y-1 text-sm">
          <div className="flex justify-between font-semibold">
            <dt>{t('auth.stub.total')}</dt>
            <dd>{formatDA(total)}</dd>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <dt>{t('auth.stub.paid')}</dt>
            <dd>{formatDA(PAID)}</dd>
          </div>
          <div className="flex justify-between text-destructive">
            <dt>{t('auth.stub.credit')}</dt>
            <dd className="font-semibold">{formatDA(credit)}</dd>
          </div>
        </dl>
      </div>
      <figcaption className="mt-6 text-center text-sm text-ink/70">
        {t('auth.stub.caption')}
      </figcaption>
    </figure>
  );
}
