'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  createZoneSchema,
  ErrorCode,
  Role,
  updateZoneSchema,
  ZONE_KINDS,
  ZoneKind,
  type ZoneDto,
} from '@erp/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { ApiError } from '@/lib/api-client';
import { useUsers } from '@/lib/users';
import { useSaveZone } from '@/lib/zones';
import { CommuneSetPicker, WilayaSetPicker } from './place-set-pickers';
import { ZoneError } from './zone-error';

/** Who may be responsible for a zone of each kind (the API checks it). */
const RESPONSIBLE_ROLES: Record<ZoneKind, readonly Role[]> = {
  [ZoneKind.AREA]: [Role.AREA_MANAGER],
  [ZoneKind.CITY]: [Role.SUPERVISOR, Role.AREA_MANAGER],
};

interface Props {
  /** Null for a new zone. */
  zone: ZoneDto | null;
  /** Every zone of the company, for the parent area of a city. */
  zones: ZoneDto[];
  onClose: () => void;
  /** After a CONFLICT: loads the saved version and puts it in the form. */
  onReload: () => void;
}

export function ZoneDialog({ zone, zones, onClose, onReload }: Props) {
  const t = useTranslations('zones');
  const tc = useTranslations('common');
  const tr = useTranslations('roles');
  const users = useUsers();
  const save = useSaveZone();
  const [name, setName] = useState(zone?.name ?? '');
  const [kind, setKind] = useState<ZoneKind>(zone?.kind ?? ZoneKind.CITY);
  const [parentZoneId, setParent] = useState(zone?.parentZoneId ?? '');
  const [wilayaCodes, setWilayas] = useState<number[]>(zone?.wilayaCodes ?? []);
  const [communeCodes, setCommunes] = useState<number[]>(zone?.communeCodes ?? []);
  const [responsibleUserId, setResponsible] = useState(zone?.responsible?.id ?? '');
  const [problem, setProblem] = useState<'name' | 'places' | null>(null);

  const areas = zones.filter((z) => z.kind === ZoneKind.AREA && z.id !== zone?.id);
  const people = (users.data ?? []).filter(
    (u) => u.active && RESPONSIBLE_ROLES[kind].includes(u.role),
  );
  // The saved responsible stays listed while the users load, or if he cannot be listed.
  const current = zone?.responsible;
  const missing = current && !people.some((u) => u.id === current.id) ? current : null;
  const conflict = save.error instanceof ApiError && save.error.code === ErrorCode.CONFLICT;

  const submit = () => {
    const body = {
      name,
      kind,
      parentZoneId: kind === ZoneKind.CITY ? parentZoneId || null : null,
      wilayaCodes,
      communeCodes,
      responsibleUserId: responsibleUserId || null,
    };
    const parsed = zone
      ? updateZoneSchema.safeParse({ ...body, version: zone.version })
      : createZoneSchema.safeParse(body);
    if (!parsed.success) {
      setProblem(parsed.error.issues.some((i) => i.path[0] === 'name') ? 'name' : 'places');
      return;
    }
    setProblem(null);
    save.mutate(
      { id: zone?.id ?? null, body: parsed.data },
      {
        onSuccess: () => {
          toast.success(zone ? t('saved') : t('created'));
          onClose();
        },
      },
    );
  };

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent className="md:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{zone ? t('edit') : t('new')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('formHelp')}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <form
          id="zone-form"
          noValidate
          className="grid min-w-0 gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {problem ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>
                {problem === 'name' ? t('nameRequired') : t('placesRequired')}
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="zone-name">{t('name')}</Label>
            <Input
              id="zone-name"
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="zone-kind">{t('kind')}</Label>
            <NativeSelect
              id="zone-kind"
              value={kind}
              disabled={zone !== null}
              aria-describedby="zone-kind-hint"
              onChange={(e) => {
                setKind(e.target.value as ZoneKind);
                setParent('');
                setResponsible('');
              }}
            >
              {ZONE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kind_${k}`)}
                </option>
              ))}
            </NativeSelect>
            <p id="zone-kind-hint" className="text-xs text-muted-foreground">
              {zone ? t('kindFixed') : t(`kindHelp_${kind}`)}
            </p>
          </div>
          {kind === ZoneKind.CITY ? (
            <div className="space-y-2">
              <Label htmlFor="zone-parent">{t('parent')}</Label>
              <NativeSelect
                id="zone-parent"
                value={parentZoneId}
                onChange={(e) => setParent(e.target.value)}
              >
                <option value="">{t('noParent')}</option>
                {areas.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          <WilayaSetPicker value={wilayaCodes} onChange={setWilayas} />
          <CommuneSetPicker value={communeCodes} onChange={setCommunes} />
          <div className="space-y-2">
            <Label htmlFor="zone-responsible">{t('responsible')}</Label>
            <NativeSelect
              id="zone-responsible"
              value={responsibleUserId}
              aria-describedby="zone-responsible-hint"
              onChange={(e) => setResponsible(e.target.value)}
            >
              <option value="">{t('noResponsible')}</option>
              {missing ? <option value={missing.id}>{missing.fullName}</option> : null}
              {people.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName} ({tr(u.role)})
                </option>
              ))}
            </NativeSelect>
            <p id="zone-responsible-hint" className="text-xs text-muted-foreground">
              {t(`responsibleHelp_${kind}`)}
            </p>
          </div>
          {/* By the save button: the form is long on a phone. */}
          <ZoneError error={save.error}>
            {conflict ? (
              <Button type="button" variant="outline" className="min-h-11" onClick={onReload}>
                {t('reload')}
              </Button>
            ) : null}
          </ZoneError>
        </form>
        <ResponsiveDialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="zone-form" disabled={save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {tc('save')}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
