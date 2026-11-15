'use client';

import { Loader2, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { useErrorMessage } from '@/lib/use-error-message';
import { useAssignDriver, useDriverOptions, useVehicles } from '@/lib/vehicles';
import { VehicleName, vehicleLabel } from './vehicle-code';

export interface DriverTarget {
  id: string;
  code: string | null;
  name: string;
  driver: { id: string; fullName: string } | null;
}

/**
 * "Qui conduit aujourd'hui ?": today's driver of a truck, in two taps. A driver who
 * already has another truck is moved after a clear warning: that truck is left without one.
 */
export function DriverDialog({
  vehicle,
  onOpenChange,
}: {
  vehicle: DriverTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <ResponsiveDialog open={vehicle !== null} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        {/* Keyed: each truck opens on its own driver, with an empty reason. */}
        {vehicle ? (
          <DriverForm key={vehicle.id} vehicle={vehicle} onOpenChange={onOpenChange} />
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function DriverForm({
  vehicle,
  onOpenChange,
}: {
  vehicle: DriverTarget;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('vehicles');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const drivers = useDriverOptions();
  const vehicles = useVehicles();
  const assign = useAssignDriver();
  const [userId, setUserId] = useState(vehicle.driver?.id ?? '');
  const [reason, setReason] = useState('');

  // The driver he had may no longer be in the list (role changed): keep him selectable.
  const options =
    vehicle.driver && !drivers.some((d) => d.id === vehicle.driver!.id)
      ? [vehicle.driver, ...drivers]
      : drivers;
  const other = userId
    ? (vehicles.data ?? []).find((v) => v.assignedUser?.id === userId && v.id !== vehicle.id)
    : undefined;
  const chosen = options.find((d) => d.id === userId);
  const unchanged = (vehicle.driver?.id ?? '') === userId;

  const submit = () => {
    if (unchanged) return;
    assign.mutate(
      {
        vehicleId: vehicle.id,
        body: { userId: userId || null, reason: reason.trim() || undefined },
      },
      {
        onSuccess: () => {
          toast.success(t('driverSaved'));
          onOpenChange(false);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>{t('whoDrives')}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          <VehicleName vehicle={vehicle} />
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <div className="space-y-2">
        <Label htmlFor="driver-user">{t('driver')}</Label>
        <NativeSelect id="driver-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">{t('noDriver')}</option>
          {options.map((d) => (
            <option key={d.id} value={d.id}>
              {d.fullName}
            </option>
          ))}
        </NativeSelect>
        <p className="text-xs text-muted-foreground">{t('driverHelp')}</p>
      </div>
      {other && chosen ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
          <span>{t('moveWarning', { driver: chosen.fullName, vehicle: vehicleLabel(other) })}</span>
        </p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="driver-reason">{t('reason')}</Label>
        <Input
          id="driver-reason"
          maxLength={120}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <ResponsiveDialogFooter>
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          {tc('cancel')}
        </Button>
        <Button type="submit" disabled={assign.isPending || unchanged}>
          {assign.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {other ? t('confirmMove') : t('saveDriver')}
        </Button>
      </ResponsiveDialogFooter>
    </form>
  );
}
