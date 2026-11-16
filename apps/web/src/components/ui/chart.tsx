'use client';

/**
 * shadcn/ui `chart` (https://ui.shadcn.com/charts), on recharts 3. Only the statistics
 * screen imports it, through a dynamic import, so recharts never reaches another page's
 * bundle. Colours come from the `--chart-N` variables of globals.css (light and dark).
 */
import * as React from 'react';
import * as RechartsPrimitive from 'recharts';
import { cn } from '@/lib/utils';

export type ChartConfig = Record<
  string,
  { label?: React.ReactNode; icon?: React.ComponentType; color?: string }
>;

/** A recharts key or value as text (they are strings or numbers here). */
const text = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number' ? String(v) : '';

const ChartContext = React.createContext<{ config: ChartConfig } | null>(null);

export function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) throw new Error('useChart must be used within a <ChartContainer />');
  return context;
}

export function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<'div'> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>['children'];
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, '')}`;
  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-layer]:outline-hidden [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector]:outline-hidden [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-hidden",
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const colored = Object.entries(config).filter(([, c]) => c.color);
  if (colored.length === 0) return null;
  const vars = colored.map(([key, c]) => `  --color-${key}: ${c.color};`).join('\n');
  // The colours are our own CSS variables, never user input.
  return <style dangerouslySetInnerHTML={{ __html: `[data-chart=${id}] {\n${vars}\n}` }} />;
}

export const ChartTooltip = RechartsPrimitive.Tooltip;
export const ChartLegend = RechartsPrimitive.Legend;

type TooltipItem = {
  name?: string | number;
  dataKey?: string | number | ((obj: unknown) => unknown);
  value?: unknown;
  color?: string;
  payload?: Record<string, unknown> & { fill?: string };
};

/**
 * The tooltip box. `formatter` turns a raw value into its display text (the API's
 * string, never a recomputed number).
 */
export function ChartTooltipContent({
  active,
  payload,
  label,
  className,
  hideLabel = false,
  labelFormatter,
  formatter,
  nameKey,
}: {
  active?: boolean;
  payload?: readonly TooltipItem[];
  label?: React.ReactNode;
  className?: string;
  hideLabel?: boolean;
  labelFormatter?: (label: React.ReactNode, payload: readonly TooltipItem[]) => React.ReactNode;
  formatter?: (item: TooltipItem) => React.ReactNode;
  nameKey?: string;
}) {
  const { config } = useChart();
  if (!active || !payload?.length) return null;
  return (
    <div
      className={cn(
        'grid min-w-32 items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl',
        className,
      )}
    >
      {!hideLabel ? (
        <div className="font-medium">{labelFormatter ? labelFormatter(label, payload) : label}</div>
      ) : null}
      <div className="grid gap-1.5">
        {payload.map((item, index) => {
          const key =
            text(nameKey ? item.payload?.[nameKey] : undefined) ||
            text(item.name) ||
            text(item.dataKey) ||
            'value';
          const itemConfig = config[key] ?? config[String(item.dataKey)];
          const color = item.payload?.fill ?? item.color;
          return (
            <div key={`${key}-${index}`} className="flex w-full items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: color }}
                aria-hidden
              />
              <span className="text-muted-foreground">{itemConfig?.label ?? item.name}</span>
              <span className="num ms-auto font-medium whitespace-nowrap text-foreground">
                {formatter ? formatter(item) : text(item.value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ChartLegendContent({
  className,
  payload,
  nameKey,
}: {
  className?: string;
  payload?: readonly { value?: unknown; dataKey?: unknown; color?: string; payload?: unknown }[];
  nameKey?: string;
}) {
  const { config } = useChart();
  if (!payload?.length) return null;
  return (
    <div
      className={cn('flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-3', className)}
    >
      {payload.map((item) => {
        const inner = item.payload as Record<string, unknown> | undefined;
        const key =
          text(nameKey ? inner?.[nameKey] : undefined) || text(item.dataKey) || text(item.value);
        return (
          <div key={key} className="flex items-center gap-1.5">
            <span
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: item.color }}
              aria-hidden
            />
            <span>{config[key]?.label ?? (text(item.value) || key)}</span>
          </div>
        );
      })}
    </div>
  );
}
