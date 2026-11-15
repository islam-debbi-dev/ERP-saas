'use client';

import { Bot, History, Laptop, Tags, Users } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Feature, Permission, Role } from '@erp/shared';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth, useFeature, usePermission } from '@/lib/auth';

/** Entries to Paramètres > Utilisateurs, Sessions and Journal d'audit. */
export function AdminLinksCard() {
  const t = useTranslations('settings');
  const { state } = useAuth();
  const role = state.user?.role;
  const manager = role === Role.OWNER || role === Role.MANAGER;
  // Phase 36: the company's own kinds of trucks.
  const warehouses = useFeature(Feature.WAREHOUSES);
  const editor = usePermission(Permission.SETTINGS_EDIT);
  const vehicleTypes = warehouses && editor;
  const links = [
    ...(manager ? [{ href: '/parametres/utilisateurs', icon: Users, key: 'users' as const }] : []),
    { href: '/parametres/sessions', icon: Laptop, key: 'sessions' as const },
    ...(manager ? [{ href: '/parametres/journal', icon: History, key: 'audit' as const }] : []),
    ...(role === Role.OWNER
      ? [{ href: '/parametres/assistant', icon: Bot, key: 'assistant' as const }]
      : []),
    ...(vehicleTypes
      ? [{ href: '/parametres/types-vehicules', icon: Tags, key: 'vehicleTypes' as const }]
      : []),
    // { href: '/parametres/abonnement', icon: CreditCard, key: 'subscription' as const },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {links.map((l) => (
        <Link
          key={l.key}
          href={l.href}
          className="rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Card className="h-full transition-colors hover:bg-muted/50">
            <CardHeader className="gap-1.5">
              <CardTitle role="heading" aria-level={2} className="flex items-center gap-2">
                <l.icon className="size-4" aria-hidden />
                {t(`${l.key}Link`)}
              </CardTitle>
              <CardDescription>{t(`${l.key}LinkHelp`)}</CardDescription>
            </CardHeader>
          </Card>
        </Link>
      ))}
    </div>
  );
}
