'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
  Upload,
  XCircle,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  IMPORT_MAX_FILE_BYTES,
  Feature,
  IMPORT_TYPES,
  type ImportFieldDef,
  type ImportIssue,
  type ImportJobDto,
  type ImportMapping,
  type ImportPreviewDto,
  type ImportType,
} from '@erp/shared';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  confirmImport,
  downloadTemplate,
  importKeys,
  previewImport,
  priceSlot,
} from '@/lib/imports';
import { useErrorMessage } from '@/lib/use-error-message';
import { useFeature } from '@/lib/auth';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 100;
type RowFilter = 'all' | 'errors' | 'warnings';

/** Label of an import field: translated, or built from the tenant's price level name. */
export function useFieldLabel() {
  const t = useTranslations('imports.fields');
  return (field: ImportFieldDef | undefined, key?: string): string => {
    if (!field) return key ?? '';
    const slot = priceSlot(field);
    if (slot) {
      const level = field.label ?? '';
      return slot.pack === 0 ? t('price', { level }) : t('packPrice', { level, pack: slot.pack });
    }
    return t.has(field.key as 'reference') ? t(field.key as 'reference') : field.key;
  };
}

/** Translated message of a row issue (unknown codes fall back to the raw code). */
function useIssueText() {
  const t = useTranslations('imports.issues');
  const ti = useTranslations('imports');
  const fieldLabel = useFieldLabel();
  return (issue: ImportIssue, fields: ImportFieldDef[]): string => {
    const field = fields.find((f) => f.key === issue.field);
    const params = { row: '', max: '', value: '', name: '', qty: '', rule: '', ...issue.params };
    const text = t.has(issue.code as 'required') ? t(issue.code as 'required', params) : issue.code;
    return issue.field
      ? ti('issueWithField', { field: fieldLabel(field, issue.field), message: text })
      : text;
  };
}

export function ImportWizard() {
  const t = useTranslations('imports');
  // Phase 20: the packaging import only with the module.
  const packagingOn = useFeature(Feature.PACKAGING);
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const fileInputId = useId();
  const [type, setType] = useState<ImportType>('PRODUCTS');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);
  const [result, setResult] = useState<ImportJobDto | null>(null);
  // One key per preview: a retried confirm of the same preview is a replay.
  const [confirmKey, setConfirmKey] = useState('');

  const showPreview = (p: ImportPreviewDto) => {
    setPreview(p);
    setConfirmKey(crypto.randomUUID());
    void queryClient.invalidateQueries({ queryKey: importKeys.all });
  };

  const upload = useMutation({
    mutationFn: (f: File) => previewImport(type, { file: f }),
    onSuccess: showPreview,
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remap = useMutation({
    mutationFn: (mapping: ImportMapping) =>
      previewImport(type, { jobId: preview?.jobId ?? '', mapping }),
    onSuccess: showPreview,
    onError: (err) => toast.error(errorMessage(err)),
  });
  const confirm = useMutation({
    mutationFn: () => confirmImport(preview?.jobId ?? '', confirmKey),
    onSuccess: (job) => {
      setResult(job);
      setPreview(null);
      void queryClient.invalidateQueries();
      toast.success(t('done'));
    },
    onError: (err) => {
      toast.error(errorMessage(err));
      void queryClient.invalidateQueries({ queryKey: importKeys.all });
    },
  });
  const template = useMutation({
    mutationFn: (kind: ImportType) => downloadTemplate(kind),
    onError: (err) => toast.error(errorMessage(err)),
  });

  const reset = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
  };

  if (result) return <ImportResult job={result} onAgain={reset} />;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('step1')}</CardTitle>
          <CardDescription>{t('step1Help')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div role="radiogroup" aria-label={t('type')} className="grid gap-3 sm:grid-cols-3">
            {IMPORT_TYPES.filter((k) => k !== 'PACKAGING_OPENING' || packagingOn).map((kind) => (
              <div
                key={kind}
                className={cn(
                  'flex flex-col gap-2 rounded-lg border p-3 text-start',
                  type === kind && 'border-primary ring-2 ring-primary/30',
                )}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={type === kind}
                  disabled={preview !== null}
                  onClick={() => setType(kind)}
                  className="text-start disabled:cursor-not-allowed"
                >
                  <span className="block font-medium">{t(`types.${kind}`)}</span>
                  <span className="block text-sm text-muted-foreground">
                    {t(`typesHelp.${kind}`)}
                  </span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-fit"
                  disabled={template.isPending}
                  onClick={() => template.mutate(kind)}
                >
                  <Download aria-hidden />
                  {t('template')}
                </Button>
              </div>
            ))}
          </div>

          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!file) return;
              if (file.size > IMPORT_MAX_FILE_BYTES) {
                toast.error(t('fileTooLarge'));
                return;
              }
              upload.mutate(file);
            }}
          >
            <div className="grid min-w-64 flex-1 gap-2">
              <Label htmlFor={fileInputId}>{t('file')}</Label>
              <input
                id={fileInputId}
                type="file"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                className="block w-full text-sm file:me-3 file:rounded-md file:border file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setPreview(null);
                }}
              />
              <p className="text-xs text-muted-foreground">{t('fileHelp')}</p>
            </div>
            <Button type="submit" disabled={!file || upload.isPending}>
              {upload.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Upload aria-hidden />
              )}
              {t('analyse')}
            </Button>
          </form>
        </CardContent>
      </Card>

      {preview ? (
        <>
          <MappingCard
            key={preview.jobId + JSON.stringify(preview.mapping)}
            preview={preview}
            busy={remap.isPending}
            onApply={(m) => remap.mutate(m)}
          />
          <PreviewCard
            preview={preview}
            confirming={confirm.isPending}
            onConfirm={() => confirm.mutate()}
            onCancel={reset}
          />
        </>
      ) : null}
    </div>
  );
}

function MappingCard({
  preview,
  busy,
  onApply,
}: {
  preview: ImportPreviewDto;
  busy: boolean;
  onApply: (mapping: ImportMapping) => void;
}) {
  const t = useTranslations('imports');
  const fieldLabel = useFieldLabel();
  const [mapping, setMapping] = useState<ImportMapping>(preview.mapping);
  const changed = JSON.stringify(mapping) !== JSON.stringify(preview.mapping);
  const baseId = useId();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('step2')}</CardTitle>
        <CardDescription>{t('step2Help', { file: preview.fileName })}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            onApply(mapping);
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {preview.fields.map((field) => {
              const id = `${baseId}-${field.key}`;
              const value = mapping[field.key];
              const missing = field.required && (value === null || value === undefined);
              return (
                <div key={field.key} className="grid gap-1.5">
                  <Label htmlFor={id}>
                    {fieldLabel(field)}
                    {field.required ? <span className="text-destructive"> *</span> : null}
                  </Label>
                  <NativeSelect
                    id={id}
                    aria-invalid={missing || undefined}
                    value={value === null || value === undefined ? '' : String(value)}
                    onChange={(e) =>
                      setMapping((m) => ({
                        ...m,
                        [field.key]: e.target.value === '' ? null : Number(e.target.value),
                      }))
                    }
                  >
                    <option value="">{t('notImported')}</option>
                    {preview.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || t('column', { n: i + 1 })}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              );
            })}
          </div>
          <Button type="submit" variant="outline" className="w-fit" disabled={!changed || busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />}
            {t('applyMapping')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PreviewCard({
  preview,
  confirming,
  onConfirm,
  onCancel,
}: {
  preview: ImportPreviewDto;
  confirming: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('imports');
  const fieldLabel = useFieldLabel();
  const issueText = useIssueText();
  const [filter, setFilter] = useState<RowFilter>(preview.counts.errors > 0 ? 'errors' : 'all');
  const [page, setPage] = useState(0);
  const { counts } = preview;
  const blocked = counts.errors > 0 || preview.fileErrors.length > 0 || counts.total === 0;

  const columns = useMemo(
    () => preview.fields.filter((f) => preview.mapping[f.key] !== null),
    [preview],
  );
  const rows = useMemo(
    () =>
      preview.rows.filter((r) =>
        filter === 'errors'
          ? r.errors.length > 0
          : filter === 'warnings'
            ? r.warnings.length > 0
            : true,
      ),
    [preview.rows, filter],
  );
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visible = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('step3')}</CardTitle>
        <CardDescription>{t('step3Help')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap gap-2" aria-live="polite">
          <Badge variant="outline">{t('countTotal', { n: counts.total })}</Badge>
          <Badge variant="secondary">{t('countValid', { n: counts.valid })}</Badge>
          {counts.creates > 0 ? (
            <Badge variant="outline">{t('countCreates', { n: counts.creates })}</Badge>
          ) : null}
          {counts.updates > 0 ? (
            <Badge variant="outline">{t('countUpdates', { n: counts.updates })}</Badge>
          ) : null}
          {counts.warnings > 0 ? (
            <Badge className="border-transparent bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
              {t('countWarnings', { n: counts.warnings })}
            </Badge>
          ) : null}
          {counts.errors > 0 ? (
            <Badge variant="destructive">{t('countErrors', { n: counts.errors })}</Badge>
          ) : null}
        </div>

        {preview.fileErrors.length > 0 ? (
          <Alert variant="destructive">
            <XCircle aria-hidden />
            <AlertTitle>{t('fileErrors')}</AlertTitle>
            <AlertDescription>
              <ul className="list-disc ps-5">
                {preview.fileErrors.map((e, i) => (
                  <li key={i}>
                    {t('issues.required_column_missing', {
                      field: fieldLabel(
                        preview.fields.find((f) => f.key === e.field),
                        e.field,
                      ),
                    })}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Label htmlFor="import-filter">{t('show')}</Label>
          <NativeSelect
            id="import-filter"
            className="w-fit"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value as RowFilter);
              setPage(0);
            }}
          >
            <option value="all">{t('filterAll')}</option>
            <option value="errors">{t('filterErrors')}</option>
            <option value="warnings">{t('filterWarnings')}</option>
          </NativeSelect>
        </div>

        <div className="max-h-[60vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 z-10">
              <TableRow>
                <TableHead className="w-12">{t('line')}</TableHead>
                <TableHead>{t('status')}</TableHead>
                {columns.map((f) => (
                  <TableHead key={f.key} className="whitespace-nowrap">
                    {fieldLabel(f)}
                  </TableHead>
                ))}
                <TableHead className="min-w-64">{t('messages')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length + 3} className="text-muted-foreground">
                    {t('noRows')}
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((r) => {
                  const level =
                    r.errors.length > 0 ? 'error' : r.warnings.length > 0 ? 'warn' : 'ok';
                  return (
                    <TableRow
                      key={r.rowNumber}
                      className={cn(
                        level === 'error' && 'bg-destructive/10 hover:bg-destructive/15',
                        level === 'warn' &&
                          'bg-amber-50 hover:bg-amber-100/70 dark:bg-amber-950/30 dark:hover:bg-amber-950/50',
                      )}
                    >
                      <TableCell className="num tabular-nums">{r.rowNumber}</TableCell>
                      <TableCell>
                        {level === 'error' ? (
                          <span className="inline-flex items-center gap-1 text-destructive">
                            <XCircle className="size-4" aria-hidden />
                            {t('rowError')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            {level === 'warn' ? (
                              <AlertTriangle className="size-4 text-amber-600" aria-hidden />
                            ) : (
                              <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
                            )}
                            {r.action ? t(`actions.${r.action}`) : null}
                          </span>
                        )}
                      </TableCell>
                      {columns.map((f) => (
                        <TableCell key={f.key} className="max-w-48 truncate" dir="auto">
                          {r.values[f.key] ?? ''}
                        </TableCell>
                      ))}
                      <TableCell className="whitespace-normal text-sm">
                        <ul className="grid gap-0.5">
                          {r.errors.map((e, i) => (
                            <li key={`e${i}`} className="text-destructive">
                              {issueText(e, preview.fields)}
                            </li>
                          ))}
                          {r.warnings.map((w, i) => (
                            <li key={`w${i}`} className="text-amber-700 dark:text-amber-300">
                              {issueText(w, preview.fields)}
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {pages > 1 ? (
          <div className="flex items-center gap-2 text-sm">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              {t('previous')}
            </Button>
            <span className="num tabular-nums">{t('page', { page: page + 1, pages })}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={page + 1 >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              {t('next')}
            </Button>
          </div>
        ) : null}

        {blocked && counts.total > 0 ? (
          <p className="text-sm text-destructive">{t('blocked')}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button onClick={onConfirm} disabled={blocked || confirming}>
            {confirming ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <FileSpreadsheet aria-hidden />
            )}
            {t('confirm', { n: counts.valid })}
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={confirming}>
            {t('cancel')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ImportResult({ job, onAgain }: { job: ImportJobDto; onAgain: () => void }) {
  const t = useTranslations('imports');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="size-5 text-emerald-600" aria-hidden />
          {t('resultTitle')}
        </CardTitle>
        <CardDescription>{t('resultHelp', { file: job.fileName })}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ul className="grid gap-1 text-sm">
          <li>{t('countTotal', { n: job.totalRows })}</li>
          {job.createdRows > 0 ? <li>{t('countCreated', { n: job.createdRows })}</li> : null}
          {job.updatedRows > 0 ? <li>{t('countUpdated', { n: job.updatedRows })}</li> : null}
          {job.openingRows > 0 ? (
            <li>{t(`countOpening.${job.type}`, { n: job.openingRows })}</li>
          ) : null}
        </ul>
        <Button className="w-fit" onClick={onAgain}>
          <Upload aria-hidden />
          {t('again')}
        </Button>
      </CardContent>
    </Card>
  );
}
