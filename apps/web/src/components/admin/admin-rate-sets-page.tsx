'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { algiersDay, type PayrollRateSetDto, type PayrollRateSetInput } from '@erp/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { adminApi } from '@/lib/admin';
import { useErrorMessage } from '@/lib/use-error-message';

const KEY = ['admin', 'payroll-rate-sets'] as const;

/** Rates are never edited: confirming or correcting one is a new row (phase 31b). */
export function AdminRateSetsPage() {
  const t = useTranslations('admin');
  const sets = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) =>
      adminApi.request<PayrollRateSetDto[]>('/admin/payroll-rate-sets', { signal }),
  });
  const [from, setFrom] = useState<PayrollRateSetDto | null>(null);

  return (
    <div className="space-y-4">
      <Link
        href="/admin"
        className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t('tenants')}
      </Link>
      <div>
        <h1 className="text-xl font-semibold">{t('rateSets')}</h1>
        <p className="text-sm text-muted-foreground">{t('rateSetsHelp')}</p>
      </div>
      {sets.isPending ? <Skeleton className="h-40 w-full" /> : null}
      <ul className="space-y-3">
        {sets.data?.map((s) => (
          <li key={s.id}>
            <Card className="gap-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <bdi dir="ltr" className="num font-semibold">
                  {s.effectiveFrom}
                </bdi>
                <Badge variant={s.toVerify ? 'outline' : 'secondary'}>
                  {s.toVerify ? t('rateToVerify') : t('rateVerified')}
                </Badge>
              </div>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <Fact label={t('rateCnasEmployee')} value={s.cnasEmployeeRate} />
                <Fact label={t('rateCnasEmployer')} value={s.cnasEmployerRate} />
                <Fact label={t('rateSnmg')} value={s.snmg} />
                <Fact label={t('rateExemption')} value={s.exemptionThreshold} />
              </dl>
              {s.note ? <p className="text-sm text-muted-foreground">{s.note}</p> : null}
              <Button variant="outline" className="min-h-11 self-start" onClick={() => setFrom(s)}>
                {t('rateNewFrom')}
              </Button>
            </Card>
          </li>
        ))}
      </ul>
      {from ? <NewSetDialog from={from} onClose={() => setFrom(null)} /> : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="min-w-0 truncate text-muted-foreground">{label}</dt>
      <dd dir="ltr" className="num">
        {value}
      </dd>
    </div>
  );
}

function NewSetDialog({ from, onClose }: { from: PayrollRateSetDto; onClose: () => void }) {
  const t = useTranslations('admin');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [effectiveFrom, setEffectiveFrom] = useState(from.effectiveFrom || algiersDay());
  const [cnasEmployeeRate, setEmployee] = useState(from.cnasEmployeeRate);
  const [cnasEmployerRate, setEmployer] = useState(from.cnasEmployerRate);
  const [snmg, setSnmg] = useState(from.snmg);
  const [toVerify, setToVerify] = useState(false);
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: (body: PayrollRateSetInput) =>
      adminApi.request<PayrollRateSetDto>('/admin/payroll-rate-sets', { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEY });
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const number = (id: string, label: string, value: string, set: (v: string) => void) => (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode="decimal"
        dir="ltr"
        className="h-11 text-base"
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </div>
  );
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent className="md:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('rateNewFrom')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('rateNewHelp')}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rate-from">{t('rateFrom')}</Label>
            <Input
              id="rate-from"
              type="date"
              className="h-11 text-base"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </div>
          {number('rate-employee', t('rateCnasEmployee'), cnasEmployeeRate, setEmployee)}
          {number('rate-employer', t('rateCnasEmployer'), cnasEmployerRate, setEmployer)}
          {number('rate-snmg', t('rateSnmg'), snmg, setSnmg)}
          <div className="flex min-h-11 items-center justify-between gap-3">
            <Label htmlFor="rate-verify">{t('rateToVerify')}</Label>
            <Switch id="rate-verify" checked={toVerify} onCheckedChange={setToVerify} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rate-note">{t('rateNote')}</Label>
            <Input
              id="rate-note"
              className="h-11 text-base"
              maxLength={255}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <ResponsiveDialogFooter>
          <Button
            className="min-h-11"
            disabled={save.isPending || !effectiveFrom}
            onClick={() =>
              save.mutate({
                ...from,
                effectiveFrom,
                cnasEmployeeRate,
                cnasEmployerRate,
                snmg,
                toVerify,
                note: note.trim() || null,
              })
            }
          >
            {t('rateSave')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
