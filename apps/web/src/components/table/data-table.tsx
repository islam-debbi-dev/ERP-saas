'use client';

import type { ReactNode } from 'react';
import type { Cell, Row, RowData, Table as TanstackTable } from '@tanstack/react-table';
import { flexRender } from '@tanstack/react-table';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Where a column goes in the phone card (docs/ui.md rule 2):
 * - `title`: the main line (truncated, the full text on tap through the row link);
 * - `subtitle`: a muted line under the title;
 * - `end`: the amount, on the end side of the title line, never pushed off;
 * - `badge`: the status, under the amount;
 * - `leading`: a checkbox before the title;
 * - `actions`: a row of buttons at the bottom of the card;
 * - `field` (default): a label / value pair in the details grid;
 * - `hidden`: not shown on a phone.
 */
export type CardSlot =
  'title' | 'subtitle' | 'end' | 'badge' | 'leading' | 'actions' | 'field' | 'hidden';

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the generics must match the library's declaration.
  interface ColumnMeta<TData extends RowData, TValue> {
    card?: CardSlot;
  }
}

/**
 * Presentation only table used by every list page. Sorting, filtering and
 * visibility state live in the page (URL backed through `nuqs`) and are passed
 * in, so a filtered view can be shared, bookmarked and printed.
 */
export type DataTableProps<TData> = {
  table: TanstackTable<TData>;
  caption?: string;
  isLoading?: boolean;
  skeletonRows?: number;
  emptyState?: ReactNode;
  onRowClick?: (row: TData) => void;
  className?: string;
  /**
   * Below `md`: `cards` (default, the lists used on the road) or `scroll`, for
   * the big office tables that may scroll inside their own container with the
   * first column sticky.
   */
  mobile?: 'cards' | 'scroll';
};

function slotOf<TData>(cell: Cell<TData, unknown>): CardSlot {
  return cell.column.columnDef.meta?.card ?? 'field';
}

function labelOf<TData>(cell: Cell<TData, unknown>): string | null {
  const header = cell.column.columnDef.header;
  return typeof header === 'string' ? header : null;
}

function RowCard<TData>({
  row,
  onRowClick,
}: {
  row: Row<TData>;
  onRowClick?: (row: TData) => void;
}) {
  const cells = row.getVisibleCells();
  const pick = (slot: CardSlot) => cells.filter((c) => slotOf(c) === slot);
  const render = (c: Cell<TData, unknown>) => (
    <div key={c.id} className="min-w-0">
      {flexRender(c.column.columnDef.cell, c.getContext())}
    </div>
  );
  const fields = pick('field');
  const actions = pick('actions');
  const endSide = [...pick('end'), ...pick('badge')];

  return (
    <li
      // Tap convenience only: the title cell carries the real link for keyboard users.
      onClick={onRowClick ? () => onRowClick(row.original) : undefined}
      data-state={row.getIsSelected() ? 'selected' : undefined}
      className={cn(
        'flex flex-col gap-3 p-4 data-[state=selected]:bg-muted',
        onRowClick && 'cursor-pointer active:bg-muted/60',
      )}
    >
      <div className="flex items-start gap-3">
        {pick('leading').map(render)}
        <div className="min-w-0 flex-1 space-y-0.5 [&_a]:block [&_a]:truncate [&_p]:truncate">
          {pick('title').map((c) => (
            <div key={c.id} className="min-w-0 truncate text-base font-medium">
              {flexRender(c.column.columnDef.cell, c.getContext())}
            </div>
          ))}
          {pick('subtitle').map((c) => (
            <div key={c.id} className="min-w-0 truncate text-sm text-muted-foreground">
              {flexRender(c.column.columnDef.cell, c.getContext())}
            </div>
          ))}
        </div>
        {endSide.length > 0 ? (
          <div className="flex shrink-0 flex-col items-end gap-1 text-end">
            {endSide.map(render)}
          </div>
        ) : null}
      </div>
      {fields.length > 0 ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {fields.map((c) => (
            <div key={c.id} className="min-w-0">
              {labelOf(c) ? <dt className="text-xs text-muted-foreground">{labelOf(c)}</dt> : null}
              <dd className="min-w-0 break-words">
                {flexRender(c.column.columnDef.cell, c.getContext())}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {actions.length > 0 ? (
        <div
          className="flex flex-wrap items-center justify-end gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          {actions.map(render)}
        </div>
      ) : null}
    </li>
  );
}

export function DataTable<TData>({
  table,
  caption,
  isLoading,
  skeletonRows = 8,
  emptyState,
  onRowClick,
  className,
  mobile = 'cards',
}: DataTableProps<TData>) {
  const isMobile = useIsMobile();
  const visibleColumns = table.getVisibleLeafColumns();
  const rows = table.getRowModel().rows;
  const showEmpty = !isLoading && rows.length === 0;

  // One view at a time, never both in the page: a hidden copy would double
  // every text for screen readers and for the tests.
  if (isMobile && mobile === 'cards') {
    return (
      <div className={cn('w-full rounded-lg border bg-card', className)}>
        {caption ? <h2 className="sr-only">{caption}</h2> : null}
        {isLoading ? (
          <ul className="divide-y" aria-busy="true">
            {Array.from({ length: Math.min(skeletonRows, 5) }).map((_, i) => (
              <li key={`skeleton-${i}`} className="space-y-2 p-4">
                <div className="flex justify-between gap-4">
                  <Skeleton className="h-5 w-1/2" />
                  <Skeleton className="h-5 w-20" />
                </div>
                <Skeleton className="h-4 w-1/3" />
              </li>
            ))}
          </ul>
        ) : showEmpty ? (
          <div className="h-56">{emptyState}</div>
        ) : (
          <ul className="divide-y">
            {rows.map((row) => (
              <RowCard key={row.id} row={row} onRowClick={onRowClick} />
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div
      // An office table on a phone scrolls in its own box, first column pinned.
      data-scroll-x={mobile === 'scroll' ? '' : undefined}
      className={cn(
        'w-full overflow-x-auto rounded-lg border bg-card print:border-0 print:bg-transparent',
        mobile === 'scroll' &&
          'max-md:[&_tr>*:first-child]:sticky max-md:[&_tr>*:first-child]:start-0 max-md:[&_tr>*:first-child]:z-10 max-md:[&_td:first-child]:bg-card max-md:[&_th:first-child]:bg-muted',
        className,
      )}
    >
      <Table className="min-w-[46rem] print:min-w-0">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="bg-muted/50 hover:bg-muted/50">
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sorted = header.column.getIsSorted();

                return (
                  <TableHead
                    key={header.id}
                    style={header.getSize() !== 150 ? { width: header.getSize() } : undefined}
                    aria-sort={
                      sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'
                    }
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="flex items-center gap-1 font-medium hover:text-foreground"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <span aria-hidden className="text-[0.6rem] leading-none opacity-70">
                          {sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : '↕'}
                        </span>
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>

        <TableBody>
          {isLoading
            ? Array.from({ length: skeletonRows }).map((_, rowIndex) => (
                <TableRow key={`skeleton-${rowIndex}`}>
                  {visibleColumns.map((column) => (
                    <TableCell key={column.id}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : null}

          {!isLoading
            ? rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? 'selected' : undefined}
                  // Mouse convenience only: put a real link in one cell for keyboard users.
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn(onRowClick && 'cursor-pointer')}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : null}

          {showEmpty ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={Math.max(visibleColumns.length, 1)} className="h-56 p-0">
                {emptyState}
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}
