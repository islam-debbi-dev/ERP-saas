'use client';

import { Check, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { type OnboardingStepKey, Role } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';
import { useDismissOnboarding, useOnboarding } from '@/lib/billing';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn } from '@/lib/utils';

const HREF: Record<OnboardingStepKey, string> = {
  companyInfo: '/parametres',
  products: '/parametres/import',
  clientBalances: '/parametres/import',
  users: '/parametres/utilisateurs',
  firstSale: '/ventes/nouvelle',
};

/**
 * The first-week checklist (phase 13), for the owner and managers. Each step ticks
 * itself from the data; the card goes away once everything is done or the owner hides it.
 */
export function OnboardingCard() {
  const t = useTranslations('onboarding');
  const errorMessage = useErrorMessage();
  const { state } = useAuth();
  const role = state.user?.role;
  const visible =
    (role === Role.OWNER || role === Role.MANAGER) && state.user?.impersonating !== true;
  const onboarding = useOnboarding(visible);
  const dismiss = useDismissOnboarding();
  const o = onboarding.data;
  if (!visible || !o || o.completed || o.dismissed) return null;

  const done = o.steps.filter((s) => s.done).length;
  return (
    <Card data-testid="onboarding-card" className="gap-4">
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {t('title')}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {t('progress', { done, total: o.steps.length })}
        </p>
        {role === Role.OWNER ? (
          <CardAction>
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11"
              disabled={dismiss.isPending}
              onClick={() =>
                dismiss.mutate(undefined, { onError: (err) => toast.error(errorMessage(err)) })
              }
            >
              {t('dismiss')}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        <div
          className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={o.steps.length}
          aria-valuenow={done}
          aria-label={t('progress', { done, total: o.steps.length })}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${(done / o.steps.length) * 100}%` }}
          />
        </div>
        <ol className="grid gap-1">
          {o.steps.map((step) => (
            <li key={step.key}>
              <Link
                href={HREF[step.key]}
                className={cn(
                  'flex min-h-14 items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                  step.done && 'text-muted-foreground',
                )}
              >
                <span
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-full border',
                    step.done
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-muted-foreground/40',
                  )}
                >
                  {step.done ? <Check className="size-4" aria-hidden /> : null}
                  <span className="sr-only">{step.done ? t('done') : t('todo')}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn('block font-medium', step.done && 'line-through')}>
                    {t(`step${step.key}`)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t(`help${step.key}`)}
                  </span>
                </span>
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground rtl:rotate-180"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
