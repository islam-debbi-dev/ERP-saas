'use client';

import { Network } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { isFieldSeller, type TeamNodeDto } from '@erp/shared';
import { EmptyState } from '@/components/shared/empty-state';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useTeam } from '@/lib/sales-force';
import { useErrorMessage } from '@/lib/use-error-message';

/** Count of everyone under a node, any depth. */
const sizeOf = (n: TeamNodeDto): number => n.members.reduce((sum, m) => sum + 1 + sizeOf(m), 0);

function Node({ node }: { node: TeamNodeDto }) {
  const t = useTranslations('team');
  const tr = useTranslations('roles');
  const size = sizeOf(node);
  return (
    <li>
      <div className={node.active ? 'py-1.5' : 'py-1.5 opacity-60'}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {node.active && isFieldSeller(node.role) ? (
            // The member's page: where he works, and moving him (phase 40b).
            <Link
              href={`/equipe/${node.id}`}
              className="inline-flex min-h-11 min-w-0 items-center font-medium text-primary underline-offset-4 hover:underline"
            >
              <span className="truncate">{node.fullName}</span>
            </Link>
          ) : (
            <span className="truncate font-medium">{node.fullName}</span>
          )}
          <Badge variant="outline" className="font-normal">
            {tr(node.role)}
          </Badge>
          {!node.active ? <Badge variant="secondary">{t('inactive')}</Badge> : null}
        </div>
        {size > 0 ? (
          <p className="text-xs text-muted-foreground">{t('memberCount', { count: size })}</p>
        ) : null}
      </div>
      {node.members.length > 0 ? (
        // Logical border and padding: the tree hangs on the start side in both directions.
        <ul className="ms-2 border-s ps-4">
          {node.members.map((m) => (
            <Node key={m.id} node={m} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** The hierarchy built from each user's manager (phase 14, SALES_FORCE). */
export function TeamTree() {
  const t = useTranslations('team');
  const errorMessage = useErrorMessage();
  const team = useTeam();
  const roots = team.data ?? [];
  // Users with nobody under them and no manager are not a team: listed once at the end.
  const teams = roots.filter((r) => r.members.length > 0);
  const alone = roots.filter((r) => r.members.length === 0);

  return (
    <Card className="gap-3 py-4">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="text-base">
          {t('title')}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t('help')}</p>
      </CardHeader>
      <CardContent>
        {team.isPending ? (
          <Skeleton className="h-24 w-full" aria-busy />
        ) : team.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(team.error)}
          </p>
        ) : teams.length === 0 ? (
          <EmptyState icon={Network} title={t('emptyTitle')} description={t('emptyDescription')} />
        ) : (
          <div className="space-y-4">
            <ul className="space-y-2">
              {teams.map((n) => (
                <Node key={n.id} node={n} />
              ))}
            </ul>
            {alone.length > 0 ? (
              <div>
                <p className="text-sm font-medium">{t('withoutTeam')}</p>
                <p className="text-sm text-muted-foreground">
                  {alone.map((u) => u.fullName).join(', ')}
                </p>
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
