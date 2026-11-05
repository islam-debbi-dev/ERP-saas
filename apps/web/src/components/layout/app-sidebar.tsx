'use client';

import { ChevronsUpDown, CirclePlay, LogOut, MessageCircle, Settings, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
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
import { useAuth, useFeatures } from '@/lib/auth';
import { useHasOverview } from '@/lib/overview';
import { tutorials, whatsappLink } from '@/lib/support';
import { isActive, type NavItem, visibleNavGroups } from './navigation';

/**
 * Alt + 1…9 jumps to a module, in the order of the visible menu. Uses `code` so it works
 * with AZERTY and macOS Option.
 */
function useNavShortcuts(items: readonly NavItem[]) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const match = /^Digit([1-9])$/.exec(e.code);
      const item = match ? items[Number(match[1]) - 1] : undefined;
      if (!item) return;
      e.preventDefault();
      router.push(item.url);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, items]);
}

export function AppSidebar() {
  const t = useTranslations();
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const features = useFeatures();
  const user = useAuth().state.user;
  const role = user?.role;
  const permissions = user?.permissions;
  // The Vue d'ensemble only for a user with more than one dépôt (phase 26).
  const hasOverview = useHasOverview() === true;
  // "Mon pointage" only for a user with an employee file (phase 31).
  const hasEmployeeFile = Boolean(user?.employeeId);
  const groups = useMemo(
    () =>
      visibleNavGroups(features, undefined, role, permissions)
        .map((g) => ({
          ...g,
          items: g.items.filter(
            (i) =>
              (i.key !== 'overview' || hasOverview) &&
              ((i.key !== 'myAttendance' && i.key !== 'myPayslips') || hasEmployeeFile),
          ),
        }))
        .filter((g) => g.items.length > 0),
    [features, role, permissions, hasOverview, hasEmployeeFile],
  );
  const items = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  useNavShortcuts(items);

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
          {groups.map((group) => (
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
        <HelpLinks />
      </SidebarContent>

      <SidebarFooter className="border-t">
        <AccountMenu />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

/** WhatsApp support and tutorial videos; each link only when it is configured. */
function HelpLinks() {
  const t = useTranslations('nav');
  const whatsapp = whatsappLink();
  const videos = tutorials();
  if (!whatsapp && videos.length === 0) return null;
  const links = [
    ...(whatsapp ? [{ key: 'helpWhatsapp' as const, url: whatsapp, icon: MessageCircle }] : []),
    ...videos.map((v) => ({ key: v.key, url: v.url, icon: CirclePlay })),
  ];
  return (
    <SidebarGroup className="mt-auto">
      <SidebarGroupLabel>{t('help')}</SidebarGroupLabel>
      <SidebarMenu>
        {links.map((l) => (
          <SidebarMenuItem key={l.key}>
            <SidebarMenuButton asChild tooltip={t(l.key)}>
              <a href={l.url} target="_blank" rel="noopener noreferrer">
                <l.icon aria-hidden />
                <span className="truncate">{t(l.key)}</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
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
