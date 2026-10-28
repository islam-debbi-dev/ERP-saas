import { formatDA, type MoneyInput } from '@erp/shared';
import { cn } from '@/lib/utils';

/**
 * An amount as `1 234 567,89 DA` (docs/ui.md rule 6): it never wraps in the
 * middle, its digits line up in columns and it stays left-to-right inside
 * Arabic text. Every amount on screen goes through this component.
 */
export function Amount({
  value,
  currency = true,
  className,
}: {
  value: MoneyInput;
  /** false in table cells whose header already says DA. */
  currency?: boolean;
  className?: string;
}) {
  return (
    <bdi dir="ltr" className={cn('num whitespace-nowrap', className)}>
      {formatDA(value, { currency })}
    </bdi>
  );
}
