'use client';

import { ChevronsUpDown, LogOut, Settings, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { BrandMark } from '@/components/shared/brand-mark';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { useAuth } from '@/lib/auth';
import { isActive, NAV_GROUPS, NAV_ITEMS } from './navigation';

/** Alt + 1…9 jumps to a module. Uses `code` so it works with AZERTY and macOS Option. */
function useNavShortcuts() {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const match = /^Digit([1-9])$/.exec(e.code);
      const item = match ? NAV_ITEMS[Number(match[1]) - 1] : undefined;
      if (!item) return;
      e.preventDefault();
      router.push(item.url);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);
}

export function AppSidebar() {
  const t = useTranslations();
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  useNavShortcuts();

  useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [pathname, isMobile, setOpenMobile]);

  return (
    <Sidebar collapsible="icon" className="border-e">
      <SidebarHeader className="border-b">
        <div className="flex h-14 items-center justify-between gap-2 px-2">
          <Link href="/tableau-de-bord" className="flex min-w-0 items-center gap-2">
            <BrandMark />
            <div className="flex min-w-0 flex-col leading-none group-data-[collapsible=icon]:hidden">
              <span className="truncate text-base font-bold tracking-tight">{t('app.name')}</span>
              <span className="truncate text-[11px] text-muted-foreground">{t('app.tagline')}</span>
            </div>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 lg:hidden"
            onClick={() => setOpenMobile(false)}
            aria-label={t('common.close')}
          >
            <X aria-hidden />
          </Button>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <nav aria-label={t('nav.mainNavigation')} className="contents">
          {NAV_GROUPS.map((group) => (
            <SidebarGroup key={group.key}>
              <SidebarGroupLabel>{t(`nav.${group.key}`)}</SidebarGroupLabel>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = isActive(pathname, item.url);
                  const label = t(`nav.${item.key}`);
                  const Icon = item.icon;
                  return (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton asChild isActive={active} tooltip={label}>
                        <Link href={item.url} aria-current={active ? 'page' : undefined}>
                          <Icon aria-hidden />
                          <span className="truncate">{label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </nav>
      </SidebarContent>

      <SidebarFooter className="border-t">
        <AccountMenu />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

function AccountMenu() {
  const t = useTranslations();
  const { state, logout } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (state.status !== 'authenticated') return null;
  const { user } = state;
  const initial = user.fullName.trim().charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg p-2 text-start transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
            aria-hidden
          >
            {initial}
          </span>
          <div className="flex min-w-0 flex-1 flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-medium">{user.fullName}</span>
            <span className="truncate text-xs text-muted-foreground">
              {t(`roles.${user.role}`)} · {user.tenantName}
            </span>
          </div>
          <ChevronsUpDown
            className="size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden"
            aria-hidden
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" side="top" className="w-60">
        <DropdownMenuLabel className="flex flex-col">
          <span className="truncate text-sm font-medium">{user.fullName}</span>
          <span className="truncate text-xs font-normal text-muted-foreground" dir="ltr">
            {user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/parametres">
            <Settings aria-hidden />
            {t('nav.settings')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={busy}
          onSelect={() => {
            setBusy(true);
            void logout()
              .then(() => router.replace('/login'))
              .finally(() => setBusy(false));
          }}
          className="text-destructive focus:text-destructive"
        >
          <LogOut aria-hidden />
          {t('nav.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
