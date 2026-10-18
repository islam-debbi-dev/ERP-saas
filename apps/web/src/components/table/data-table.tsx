'use client';

import type { ReactNode } from 'react';
import type { Table as TanstackTable } from '@tanstack/react-table';
import { flexRender } from '@tanstack/react-table';
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
};

export function DataTable<TData>({
  table,
  caption,
  isLoading,
  skeletonRows = 8,
  emptyState,
  onRowClick,
  className,
}: DataTableProps<TData>) {
  const visibleColumns = table.getVisibleLeafColumns();
  const rows = table.getRowModel().rows;
  const showEmpty = !isLoading && rows.length === 0;

  return (
    <div
      className={cn(
        'w-full overflow-x-auto rounded-lg border bg-card print:border-0 print:bg-transparent',
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
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key === 'Enter') onRowClick(row.original);
                        }
                      : undefined
                  }
                  className={cn(
                    onRowClick &&
                      'cursor-pointer focus-visible:bg-muted/60 focus-visible:outline-none',
                  )}
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
