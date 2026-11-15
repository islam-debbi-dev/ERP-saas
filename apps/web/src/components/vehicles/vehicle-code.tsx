import { cn } from '@/lib/utils';

/**
 * A vehicle or dépôt code (`VAN-28 MXT 01`), shown as the owner typed it. Always
 * left-to-right and isolated, so Arabic text around it never reorders its parts.
 */
export function VehicleCode({ code, className }: { code: string; className?: string }) {
  return (
    <bdi dir="ltr" className={cn('whitespace-nowrap tabular-nums', className)}>
      {code}
    </bdi>
  );
}

/** The same isolation for plain text (an `<option>` cannot hold a `<bdi>`). */
export const isolateLtr = (text: string) => `⁦${text}⁩`;

/** `code · name` when there is a code, as lists and pickers show a truck. */
export function vehicleLabel(v: { code: string | null; name: string }): string {
  return v.code ? `${isolateLtr(v.code)} · ${v.name}` : v.name;
}

/** A truck named in a sentence or a line: the code first, then its name. */
export function VehicleName({
  vehicle,
  className,
}: {
  vehicle: { code: string | null; name: string };
  className?: string;
}) {
  return (
    <span className={className}>
      {vehicle.code ? (
        <>
          <VehicleCode code={vehicle.code} className="font-medium" />
          <span className="text-muted-foreground"> · </span>
        </>
      ) : null}
      {vehicle.name}
    </span>
  );
}
