'use client';

import { Check, Copy, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  type InviteMode,
  type InviteResultDto,
  type Permission,
  PERMISSIONS,
  Role,
  ROLE_PERMISSIONS,
  type UserDto,
} from '@erp/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { useResetPassword, useInviteUser, useSetPermissions, useUpdateUser } from '@/lib/users';
import { useErrorMessage } from '@/lib/use-error-message';
import { cn } from '@/lib/utils';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const INVITE_ROLES = [Role.SELLER, Role.STOREKEEPER, Role.MANAGER, Role.OWNER] as const;

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('inviteTitle')}</DialogTitle>
          <DialogDescription>{t('inviteHelp')}</DialogDescription>
        </DialogHeader>
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
                {INVITE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {tr(r)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <ModePicker mode={mode} onMode={setMode} password={password} onPassword={setPassword} />
          </form>
        )}
        <DialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange(false)}>{t('done')}</Button>
          ) : (
            <Button type="submit" form="invite-form" disabled={invite.isPending}>
              {invite.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('invite')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('editTitle')}</DialogTitle>
          <DialogDescription>{user.fullName}</DialogDescription>
        </DialogHeader>
        <form
          id="edit-user-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            update.mutate(
              { id: user.id, body: { fullName, email, phone, role } },
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
              {Object.values(Role).map((r) => (
                <option key={r} value={r}>
                  {tr(r)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </form>
        <DialogFooter>
          <Button type="submit" form="edit-user-form" disabled={update.isPending}>
            {update.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One switch per sensitive permission. What differs from the role's default is
 * sent as grants / revokes, so a later role change keeps the role's new defaults.
 */
export function PermissionsDialog({ user, open, onOpenChange }: DialogProps & { user: UserDto }) {
  const t = useTranslations('users');
  const tp = useTranslations('permissions');
  const errorMessage = useErrorMessage();
  const save = useSetPermissions();
  const defaults = new Set<Permission>(ROLE_PERMISSIONS[user.role]);
  const [on, setOn] = useState<Set<Permission>>(new Set(user.permissions));

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('permissionsTitle', { name: user.fullName })}</DialogTitle>
          <DialogDescription>{t('permissionsHelp')}</DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-md border">
          {PERMISSIONS.map((p) => (
            <li key={p} className="flex items-start justify-between gap-4 p-3">
              <div className="space-y-0.5">
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
        <DialogFooter>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('resetTitle', { name: user.fullName })}</DialogTitle>
          <DialogDescription>{t('resetHelp')}</DialogDescription>
        </DialogHeader>
        {result ? (
          <InviteLink result={result} />
        ) : (
          <ModePicker mode={mode} onMode={setMode} password={password} onPassword={setPassword} />
        )}
        <DialogFooter>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
