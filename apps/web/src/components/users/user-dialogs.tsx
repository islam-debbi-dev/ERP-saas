'use client';

import { Check, Copy, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  Feature,
  type InviteMode,
  type InviteResultDto,
  type Permission,
  PERMISSION_GROUPS,
  type PermissionGroup,
  PERMISSIONS,
  Role,
  ROLE_PERMISSIONS,
  SENSITIVE_PERMISSIONS,
  type UserDto,
  WarehouseAccessLevel,
} from '@erp/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth, useFeature } from '@/lib/auth';
import { useWarehouses } from '@/lib/stock';
import {
  useResetPassword,
  useInviteUser,
  useSetPermissions,
  useSetUserAccess,
  useUpdateUser,
  useUserAccess,
  useUsers,
} from '@/lib/users';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn } from '@/lib/utils';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const INVITE_ROLES = [
  Role.SELLER,
  Role.STOREKEEPER,
  Role.MANAGER,
  Role.OWNER,
  Role.SUPERVISOR,
  Role.LIVREUR,
] as const;

/** Roles of the sales force (phase 14): offered only when the company has the module. */
const SALES_FORCE_ROLES = new Set<Role>([Role.SUPERVISOR, Role.LIVREUR]);
const MANAGER_ROLES = new Set<Role>([Role.OWNER, Role.MANAGER, Role.SUPERVISOR]);

function useRoleChoices(current?: Role): Role[] {
  const salesForce = useFeature(Feature.SALES_FORCE);
  return INVITE_ROLES.filter((r) => salesForce || !SALES_FORCE_ROLES.has(r) || r === current);
}

/** Who the user reports to (phase 14): an active owner, manager or supervisor, not himself. */
function ManagerField({
  id,
  userId,
  value,
  onChange,
}: {
  id: string;
  userId: string | null;
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useTranslations('users');
  const users = useUsers();
  const salesForce = useFeature(Feature.SALES_FORCE);
  if (!salesForce) return null;
  const options = (users.data ?? []).filter(
    (u) => u.active && u.id !== userId && MANAGER_ROLES.has(u.role),
  );
  return (
    <Field id={id} label={t('manager')} hint={t('managerHint')}>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('noManager')}</option>
        {options.map((u) => (
          <option key={u.id} value={u.id}>
            {u.fullName}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Temporary password (told to the user) or a one-time link (sent on WhatsApp…). */
function ModePicker({
  mode,
  onMode,
  password,
  onPassword,
}: {
  mode: InviteMode;
  onMode: (m: InviteMode) => void;
  password: string;
  onPassword: (p: string) => void;
}) {
  const t = useTranslations('users');
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t('mode')}</legend>
      {(['LINK', 'PASSWORD'] as const).map((m) => (
        <label
          key={m}
          className={cn(
            'flex cursor-pointer gap-3 rounded-md border p-3 text-sm',
            mode === m && 'border-primary bg-primary/5',
          )}
        >
          <input
            type="radio"
            name="invite-mode"
            className="mt-0.5 accent-primary"
            checked={mode === m}
            onChange={() => onMode(m)}
          />
          <span>
            <span className="block font-medium">{t(`mode_${m}`)}</span>
            <span className="text-muted-foreground">{t(`mode_${m}_help`)}</span>
          </span>
        </label>
      ))}
      {mode === 'PASSWORD' ? (
        <Field id="invite-password" label={t('tempPassword')} hint={t('tempPasswordHint')}>
          <Input
            id="invite-password"
            dir="ltr"
            autoComplete="off"
            value={password}
            onChange={(e) => onPassword(e.target.value)}
          />
        </Field>
      ) : null}
    </fieldset>
  );
}

/** The invitation link, shown once (only its hash is stored). */
function InviteLink({ result }: { result: InviteResultDto }) {
  const t = useTranslations('users');
  const [copied, setCopied] = useState(false);
  if (!result.inviteUrl) return null;
  const copy = async () => {
    await navigator.clipboard.writeText(result.inviteUrl ?? '');
    setCopied(true);
    toast.success(t('linkCopied'));
  };
  return (
    <div className="space-y-2">
      <Alert>
        <AlertDescription>{t('linkOnce')}</AlertDescription>
      </Alert>
      <div className="flex gap-2">
        <Input readOnly dir="ltr" value={result.inviteUrl} onFocus={(e) => e.target.select()} />
        <Button type="button" variant="outline" onClick={() => void copy()}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {t('copy')}
        </Button>
      </div>
    </div>
  );
}

export function InviteDialog({ open, onOpenChange }: DialogProps) {
  const t = useTranslations('users');
  const tr = useTranslations('roles');
  const errorMessage = useErrorMessage();
  const invite = useInviteUser();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<(typeof INVITE_ROLES)[number]>(Role.SELLER);
  const roles = useRoleChoices();
  const [managerId, setManagerId] = useState('');
  const [mode, setMode] = useState<InviteMode>('LINK');
  const [password, setPassword] = useState('');
  const [result, setResult] = useState<InviteResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    invite.mutate(
      {
        fullName,
        email,
        phone,
        role,
        managerId: managerId || null,
        mode,
        ...(mode === 'PASSWORD' ? { password } : {}),
      },
      {
        onSuccess: (r) => {
          if (r.inviteUrl) setResult(r);
          else {
            toast.success(t('invited', { name: r.user.fullName }));
            onOpenChange(false);
          }
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('inviteTitle')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('inviteHelp')}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {result ? (
          <InviteLink result={result} />
        ) : (
          <form
            id="invite-form"
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <Field id="invite-name" label={t('fullName')}>
              <Input
                id="invite-name"
                autoFocus
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="invite-phone" label={t('phone')} hint={t('loginHint')}>
                <Input
                  id="invite-phone"
                  dir="ltr"
                  inputMode="tel"
                  placeholder="0550 12 34 56"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </Field>
              <Field id="invite-email" label={t('email')}>
                <Input
                  id="invite-email"
                  dir="ltr"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
            </div>
            <Field id="invite-role" label={t('role')}>
              <NativeSelect
                id="invite-role"
                value={role}
                onChange={(e) => setRole(e.target.value as (typeof INVITE_ROLES)[number])}
              >
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {tr(r)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <ManagerField
              id="invite-manager"
              userId={null}
              value={managerId}
              onChange={setManagerId}
            />
            <ModePicker mode={mode} onMode={setMode} password={password} onPassword={setPassword} />
          </form>
        )}
        <ResponsiveDialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange(false)}>{t('done')}</Button>
          ) : (
            <Button type="submit" form="invite-form" disabled={invite.isPending}>
              {invite.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('invite')}
            </Button>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

export function EditUserDialog({ user, open, onOpenChange }: DialogProps & { user: UserDto }) {
  const t = useTranslations('users');
  const tr = useTranslations('roles');
  const errorMessage = useErrorMessage();
  const update = useUpdateUser();
  const [fullName, setFullName] = useState(user.fullName);
  const [email, setEmail] = useState(user.email ?? '');
  const [phone, setPhone] = useState(user.phone ?? '');
  const [role, setRole] = useState<Role>(user.role);
  const roles = useRoleChoices(user.role);
  const salesForce = useFeature(Feature.SALES_FORCE);
  const [managerId, setManagerId] = useState(user.managerId ?? '');
  const [error, setError] = useState<string | null>(null);

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('editTitle')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{user.fullName}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <form
          id="edit-user-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            update.mutate(
              {
                id: user.id,
                body: {
                  fullName,
                  email,
                  phone,
                  role,
                  // Without the module the hierarchy is not shown, so it is left as it is.
                  ...(salesForce ? { managerId: managerId || null } : {}),
                },
              },
              {
                onSuccess: () => {
                  toast.success(t('saved'));
                  onOpenChange(false);
                },
                onError: (err) => setError(errorMessage(err)),
              },
            );
          }}
        >
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Field id="edit-name" label={t('fullName')}>
            <Input id="edit-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="edit-phone" label={t('phone')}>
              <Input
                id="edit-phone"
                dir="ltr"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>
            <Field id="edit-email" label={t('email')}>
              <Input
                id="edit-email"
                dir="ltr"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
          </div>
          <Field id="edit-role" label={t('role')}>
            <NativeSelect
              id="edit-role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {tr(r)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <ManagerField
            id="edit-manager"
            userId={user.id}
            value={managerId}
            onChange={setManagerId}
          />
        </form>
        <ResponsiveDialogFooter>
          <Button type="submit" form="edit-user-form" disabled={update.isPending}>
            {update.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('save')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/**
 * One switch per permission, grouped by module (phase 24, MULTI_UNIT; without the module
 * only the sensitive actions of phases 1–23). What differs from the role's default is
 * sent as grants / revokes, so a later role change keeps the role's new defaults.
 */
export function PermissionsDialog({ user, open, onOpenChange }: DialogProps & { user: UserDto }) {
  const t = useTranslations('users');
  const tp = useTranslations('permissions');
  const tu = useTranslations('multiUnit');
  const errorMessage = useErrorMessage();
  const save = useSetPermissions();
  const multiUnit = useFeature(Feature.MULTI_UNIT);
  const defaults = new Set<Permission>(ROLE_PERMISSIONS[user.role]);
  const [on, setOn] = useState<Set<Permission>>(new Set(user.permissions));
  const groups = (Object.entries(PERMISSION_GROUPS) as [PermissionGroup, readonly Permission[]][])
    .map(
      ([group, list]) =>
        [group, multiUnit ? list : list.filter((p) => SENSITIVE_PERMISSIONS.includes(p))] as const,
    )
    .filter(([, list]) => list.length > 0);
  const changed = PERMISSIONS.some((p) => on.has(p) !== defaults.has(p));

  const submit = () => {
    const grants = PERMISSIONS.filter((p) => on.has(p) && !defaults.has(p));
    const revokes = PERMISSIONS.filter((p) => !on.has(p) && defaults.has(p));
    save.mutate(
      { id: user.id, body: { grants, revokes } },
      {
        onSuccess: () => {
          toast.success(t('saved'));
          onOpenChange(false);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {t('permissionsTitle', { name: user.fullName })}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('permissionsHelp')}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="space-y-4">
          {groups.map(([group, list]) => (
            <section key={group} aria-labelledby={`perm-group-${group}`} className="space-y-1.5">
              {groups.length > 1 ? (
                <h3 id={`perm-group-${group}`} className="text-sm font-semibold">
                  {tu(`group_${group}`)}
                </h3>
              ) : null}
              <ul className="divide-y rounded-md border">
                {list.map((p) => (
                  <li key={p} className="flex items-start justify-between gap-4 p-3">
                    <div className="min-w-0 space-y-0.5">
                      <Label htmlFor={`perm-${p}`} className="font-medium">
                        {tp(`${p}.label`)}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {tp(`${p}.help`)}
                        {defaults.has(p) ? ` · ${t('fromRole')}` : ''}
                      </p>
                    </div>
                    <Switch
                      id={`perm-${p}`}
                      checked={on.has(p)}
                      onCheckedChange={(checked) =>
                        setOn((prev) => {
                          const next = new Set(prev);
                          if (checked) next.add(p);
                          else next.delete(p);
                          return next;
                        })
                      }
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <ResponsiveDialogFooter>
          <Button
            variant="outline"
            disabled={!changed || save.isPending}
            onClick={() => setOn(new Set(defaults))}
          >
            {tu('resetDefaults')}
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('save')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

type AccessChoice = 'NONE' | WarehouseAccessLevel;
const ACCESS_CHOICES: AccessChoice[] = [
  'NONE',
  WarehouseAccessLevel.VIEW_STATS,
  WarehouseAccessLevel.OPERATE,
];

/**
 * The dépôts a user works in or sees the figures of (phase 24): one choice per dépôt,
 * Aucun / Voir les statistiques / Travailler. Trucks follow their dépôt.
 */
export function WarehouseAccessDialog({
  user,
  open,
  onOpenChange,
}: DialogProps & { user: UserDto }) {
  const t = useTranslations('multiUnit');
  const tUsers = useTranslations('users');
  const errorMessage = useErrorMessage();
  const access = useUserAccess(user.id);
  const warehouses = useWarehouses();
  const save = useSetUserAccess();
  const { state } = useAuth();
  const canManage =
    state.user?.role === Role.OWNER ||
    (state.user?.permissions.includes('WAREHOUSE_ACCESS_MANAGE') ?? false);
  const depots = (warehouses.data ?? []).filter((w) => w.type !== 'VEHICLE');
  const [edits, setEdits] = useState<Record<string, AccessChoice>>({});
  const levelOf = (warehouseId: string): AccessChoice =>
    edits[warehouseId] ??
    access.data?.access.find((a) => a.warehouseId === warehouseId)?.level ??
    'NONE';

  const submit = () => {
    const list = depots
      .map((w) => ({ warehouseId: w.id, level: levelOf(w.id) }))
      .filter((a): a is { warehouseId: string; level: WarehouseAccessLevel } => a.level !== 'NONE');
    save.mutate(
      { id: user.id, body: { access: list } },
      {
        onSuccess: () => {
          toast.success(t('accessSaved'));
          onOpenChange(false);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('accessTitle', { name: user.fullName })}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('accessHelp')}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {access.isPending || warehouses.isPending ? (
          <div className="space-y-2" aria-busy>
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : access.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(access.error)}
          </p>
        ) : access.data.allWarehouses ? (
          <p className="rounded-md border p-3 text-sm">{t('allAccess')}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {depots.map((w) => (
              <li
                key={w.id}
                className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <Label htmlFor={`access-${w.id}`} className="min-w-0 truncate font-medium">
                  {w.name}
                </Label>
                <NativeSelect
                  id={`access-${w.id}`}
                  className="sm:w-56"
                  value={levelOf(w.id)}
                  disabled={!canManage}
                  onChange={(e) =>
                    setEdits((prev) => ({ ...prev, [w.id]: e.target.value as AccessChoice }))
                  }
                >
                  {ACCESS_CHOICES.map((c) => (
                    <option key={c} value={c}>
                      {t(`level${c}`)}
                    </option>
                  ))}
                </NativeSelect>
              </li>
            ))}
          </ul>
        )}
        {canManage && access.data && !access.data.allWarehouses ? (
          <ResponsiveDialogFooter>
            <Button onClick={submit} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {tUsers('save')}
            </Button>
          </ResponsiveDialogFooter>
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

export function ResetPasswordDialog({ user, open, onOpenChange }: DialogProps & { user: UserDto }) {
  const t = useTranslations('users');
  const errorMessage = useErrorMessage();
  const reset = useResetPassword();
  const [mode, setMode] = useState<InviteMode>('LINK');
  const [password, setPassword] = useState('');
  const [result, setResult] = useState<InviteResultDto | null>(null);

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="md:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('resetTitle', { name: user.fullName })}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('resetHelp')}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {result ? (
          <InviteLink result={result} />
        ) : (
          <ModePicker mode={mode} onMode={setMode} password={password} onPassword={setPassword} />
        )}
        <ResponsiveDialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange(false)}>{t('done')}</Button>
          ) : (
            <Button
              disabled={reset.isPending}
              onClick={() =>
                reset.mutate(
                  { id: user.id, body: mode === 'PASSWORD' ? { mode, password } : { mode } },
                  {
                    onSuccess: (r) => {
                      if (r.inviteUrl) setResult(r);
                      else {
                        toast.success(t('resetDone'));
                        onOpenChange(false);
                      }
                    },
                    onError: (err) => toast.error(errorMessage(err)),
                  },
                )
              }
            >
              {reset.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('reset')}
            </Button>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
