'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  type AiConfigTestResult,
  type AiProvider,
  type AiProviderConfigDto,
  type AiProviderConfigInput,
  aiProviderConfigSchema,
  AI_PROVIDERS,
} from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { useErrorMessage } from '@/lib/use-error-message';

/** Starting points only: prices change, so the admin keeps them right. */
const MODEL_SUGGESTIONS: Record<AiProvider, string[]> = {
  ANTHROPIC: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  GEMINI: ['gemini-3-flash-preview'],
  OPENAI_COMPATIBLE: [],
};

interface FormState {
  provider: AiProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
  input: string;
  cached: string;
  output: string;
  enabled: boolean;
}

function initial(config: AiProviderConfigDto | null): FormState {
  return {
    provider: config?.provider ?? 'ANTHROPIC',
    model: config?.model ?? 'claude-opus-5-5',
    baseUrl: config?.baseUrl ?? '',
    apiKey: '',
    input: config?.inputPricePerMTokUsd ?? '4',
    cached: config?.cachedInputPricePerMTokUsd ?? '0.2',
    output: config?.outputPricePerMTokUsd ?? '20',
    enabled: config?.enabled ?? true,
  };
}

/** The same form for the platform (super-admin) and for a company's own key (OWNER). */
export function AiProviderForm({
  config,
  onSave,
  onTest,
}: {
  config: AiProviderConfigDto | null;
  onSave: (input: AiProviderConfigInput) => Promise<AiProviderConfigDto>;
  onTest: (input: AiProviderConfigInput) => Promise<AiConfigTestResult>;
}) {
  const t = useTranslations('assistantSettings');
  const a = useTranslations('assistant');
  const errors = useTranslations('errors');
  const errorMessage = useErrorMessage();
  const [form, setForm] = useState(() => initial(config));
  const [hint, setHint] = useState(config?.keyHint ?? null);
  const [replacing, setReplacing] = useState(!config);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setResult(null);
    setForm((f) => ({ ...f, [key]: value }));
  };

  const parsed = () =>
    aiProviderConfigSchema.safeParse({
      provider: form.provider,
      model: form.model,
      baseUrl: form.provider === 'OPENAI_COMPATIBLE' ? form.baseUrl : null,
      ...(form.apiKey ? { apiKey: form.apiKey } : {}),
      inputPricePerMTokUsd: form.input,
      cachedInputPricePerMTokUsd: form.cached,
      outputPricePerMTokUsd: form.output,
      enabled: form.enabled,
    });

  const run = async (kind: 'save' | 'test') => {
    const input = parsed();
    if (!input.success) {
      setResult({ ok: false, text: t('invalid') });
      return;
    }
    setBusy(kind);
    setResult(null);
    try {
      if (kind === 'test') {
        const test = await onTest(input.data);
        setResult(
          test.ok
            ? { ok: true, text: t('testOk') }
            : { ok: false, text: errors(test.code ?? 'AI_UNAVAILABLE') },
        );
      } else {
        const saved = await onSave(input.data);
        setHint(saved.keyHint);
        setReplacing(false);
        setForm((f) => ({ ...f, apiKey: '' }));
        toast.success(t('saved'));
      }
    } catch (err) {
      setResult({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="gap-4 p-4">
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run('save');
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="ai-provider">{t('provider')}</Label>
          <NativeSelect
            id="ai-provider"
            value={form.provider}
            onChange={(e) => set('provider', e.target.value as AiProvider)}
          >
            {AI_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {a(`provider.${p}`)}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="ai-model">{t('model')}</Label>
          <Input
            id="ai-model"
            dir="ltr"
            list="ai-models"
            value={form.model}
            onChange={(e) => set('model', e.target.value)}
          />
          <datalist id="ai-models">
            {MODEL_SUGGESTIONS[form.provider].map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>

        {form.provider === 'OPENAI_COMPATIBLE' ? (
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="ai-base-url">{t('baseUrl')}</Label>
            <Input
              id="ai-base-url"
              dir="ltr"
              type="url"
              inputMode="url"
              placeholder="https://api.mistral.ai/v1"
              value={form.baseUrl}
              onChange={(e) => set('baseUrl', e.target.value)}
            />
          </div>
        ) : null}

        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="ai-key">{t('apiKey')}</Label>
          {hint && !replacing ? (
            <div className="flex min-h-11 flex-wrap items-center gap-3">
              <bdi dir="ltr" className="num">
                ••••{hint}
              </bdi>
              <Button
                id="ai-key"
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => setReplacing(true)}
              >
                {t('replaceKey')}
              </Button>
            </div>
          ) : (
            <Input
              id="ai-key"
              dir="ltr"
              type="password"
              autoComplete="off"
              value={form.apiKey}
              onChange={(e) => set('apiKey', e.target.value)}
            />
          )}
          <p className="text-xs text-muted-foreground">{t('keyHelp')}</p>
        </div>

        <fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-medium">{t('prices')}</legend>
          {(
            [
              ['input', 'priceInput'],
              ['cached', 'priceCached'],
              ['output', 'priceOutput'],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="grid gap-2">
              <Label htmlFor={`ai-${key}`}>{t(label)}</Label>
              <Input
                id={`ai-${key}`}
                dir="ltr"
                inputMode="decimal"
                value={form[key]}
                onChange={(e) => set(key, e.target.value)}
              />
            </div>
          ))}
          <p className="text-xs text-muted-foreground sm:col-span-3">{t('pricesHelp')}</p>
        </fieldset>

        <div className="flex min-h-11 items-center justify-between gap-3 sm:col-span-2">
          <Label htmlFor="ai-enabled">{t('enabled')}</Label>
          <Switch
            id="ai-enabled"
            checked={form.enabled}
            onCheckedChange={(v) => set('enabled', v)}
          />
        </div>

        <p className="text-xs text-muted-foreground sm:col-span-2">
          {t('dataNotice', { provider: a(`provider.${form.provider}`) })}
        </p>

        {result ? (
          <p
            role="status"
            className={
              result.ok
                ? 'text-sm text-muted-foreground sm:col-span-2'
                : 'text-sm text-destructive sm:col-span-2'
            }
          >
            {result.text}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button type="submit" className="min-h-11" disabled={busy !== null}>
            {busy === 'save' ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('save')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={busy !== null}
            onClick={() => void run('test')}
          >
            {busy === 'test' ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('test')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
