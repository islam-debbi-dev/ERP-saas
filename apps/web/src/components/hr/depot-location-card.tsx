'use client';

import { LocateFixed } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import type { WarehouseDetailDto } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { capturePosition } from '@/lib/geo';
import { useSaveWarehouse } from '@/lib/stock';
import { useErrorMessage } from '@/lib/use-error-message';

/** The point self check-ins are measured from (phase 31). */
export function DepotLocationCard({ warehouse }: { warehouse: WarehouseDetailDto }) {
  const t = useTranslations('hr');
  const errorMessage = useErrorMessage();
  const save = useSaveWarehouse();
  const [radius, setRadius] = useState(String(warehouse.location?.radiusM ?? ''));
  const [locating, setLocating] = useState(false);

  const write = (location: { lat: number; lng: number; radiusM: number | null } | null) =>
    save.mutate(
      { id: warehouse.id, body: { location } },
      {
        onSuccess: () => toast.success(t('depotPointSaved')),
        onError: (err) => toast.error(errorMessage(err)),
      },
    );

  const here = async () => {
    setLocating(true);
    const geo = await capturePosition();
    setLocating(false);
    if (geo?.lat === undefined || geo.lng === undefined) {
      toast.error(t('noPosition'));
      return;
    }
    write({ lat: geo.lat, lng: geo.lng, radiusM: radius ? Number(radius) : null });
  };

  return (
    <Card className="gap-3 p-4">
      <h2 className="font-semibold">{t('depotPoint')}</h2>
      <p className="text-sm text-muted-foreground">
        {warehouse.location ? (
          <span dir="ltr" className="num">
            {warehouse.location.lat}, {warehouse.location.lng}
          </span>
        ) : (
          t('depotPointNone')
        )}
      </p>
      <div className="space-y-2 md:max-w-52">
        <Label htmlFor="depot-radius">{t('depotRadius')}</Label>
        <Input
          id="depot-radius"
          inputMode="numeric"
          className="h-11 text-base"
          value={radius}
          onChange={(e) => setRadius(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="min-h-11"
          disabled={locating || save.isPending}
          onClick={() => void here()}
        >
          <LocateFixed aria-hidden />
          {t('depotPointHere')}
        </Button>
        {warehouse.location ? (
          <Button
            variant="ghost"
            className="min-h-11"
            disabled={save.isPending}
            onClick={() => write(null)}
          >
            {t('depotPointClear')}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
