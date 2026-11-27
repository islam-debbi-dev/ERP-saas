import type { ReactNode } from 'react';

/** One foldable group of the statistics filter sheet, with how many values are chosen. */
export function FilterGroup({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <details className="rounded-md border px-2 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 text-sm font-medium">
        <span>{title}</span>
        {count > 0 ? (
          <span className="rounded-full bg-primary px-2 text-xs text-primary-foreground">
            <bdi dir="ltr">{count}</bdi>
          </span>
        ) : null}
      </summary>
      <div className="pb-2">{children}</div>
    </details>
  );
}
