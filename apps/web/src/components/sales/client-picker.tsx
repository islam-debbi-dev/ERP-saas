'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ClientDto } from '@erp/shared';
import { BalanceAmount } from '@/components/clients/balance-amount';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useClientPages } from '@/lib/clients';
import { cn } from '@/lib/utils';

/** F2 on the sale screen: type to search, arrows to move, Enter to pick. */
export function ClientPicker({
  open,
  onOpenChange,
  onPick,
  withCounter = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (client: ClientDto | null) => void;
  /** Offer "client comptoir" as the first row (sales only). */
  withCounter?: boolean;
}) {
  const t = useTranslations('sales');
  const [search, setSearch] = useState('');
  /** null = the default row: the first client when searching, else "client comptoir". */
  const [active, setActive] = useState<number | null>(null);
  const debounced = useDebouncedValue(search.trim(), 200);
  const pages = useClientPages({ search: debounced, hasDebt: false, overLimit: false });
  const clients = pages.data?.pages[0]?.items.slice(0, 20) ?? [];
  // Row 0 is "client comptoir" (sales), then the clients.
  const options: (ClientDto | null)[] = withCounter ? [null, ...clients] : clients;
  const firstClient = withCounter ? 1 : 0;
  const current = Math.max(
    0,
    Math.min(active ?? (debounced && clients.length > 0 ? firstClient : 0), options.length - 1),
  );

  const pick = (c: ClientDto | null) => {
    onPick(c);
    onOpenChange(false);
    setSearch('');
    setActive(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('pickClient')}</DialogTitle>
          <DialogDescription>{t('pickClientHelp')}</DialogDescription>
        </DialogHeader>
        <Input
          type="search"
          autoFocus
          aria-label={t('searchClient')}
          placeholder={t('searchClient')}
          aria-controls="client-options"
          aria-activedescendant={`client-option-${current}`}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setActive(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive(Math.min(current + 1, options.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive(Math.max(current - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const choice = options[current];
              if (choice !== undefined) pick(choice);
            }
          }}
        />
        <ul
          id="client-options"
          role="listbox"
          aria-label={t('pickClient')}
          className="max-h-80 overflow-y-auto rounded-md border"
        >
          {options.map((c, i) => (
            <li
              key={c?.id ?? 'comptoir'}
              id={`client-option-${i}`}
              role="option"
              aria-selected={i === current}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0',
                i === current && 'bg-accent text-accent-foreground',
              )}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(c)}
            >
              {c ? (
                <>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="block text-xs text-muted-foreground" dir="ltr">
                      {[c.code, c.phone].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <BalanceAmount value={c.balance} showHint={false} className="text-sm" />
                </>
              ) : (
                <span className="font-medium">{t('counterClient')}</span>
              )}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
