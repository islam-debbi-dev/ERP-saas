import fr from '@/messages/fr.json';

type Messages = typeof fr;

/** Every "a.b.c" path to a string in the messages file. */
type Paths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];

export type MessageKey = Paths<Messages>;

function lookup(key: string): string | undefined {
  let node: unknown = fr;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/**
 * French UI strings (AGENTS.md: no hard-coded strings in components).
 * `t('dashboard.welcome', { name })` replaces `{name}`.
 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const message = lookup(key) ?? key;
  if (!params) return message;
  return message.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

/** Message for an API error code, with a generic fallback. */
export function errorMessage(code: string | undefined): string {
  return (code && lookup(`errors.${code}`)) || t('errors.INTERNAL_ERROR');
}
