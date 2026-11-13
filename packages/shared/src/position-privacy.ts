/**
 * Phase 35: the user's position ("Près de moi") is used for one query and never kept.
 * Everything that leaves the process for a log or for Sentry goes through this file, on the
 * API and in the browser, so there is one list of parameter names and one way to drop them.
 *
 * The view box of `/clients/map` is dropped too: after "Près de moi" it is centred on the user.
 */
const POSITION_PARAMS = new Set(['lat', 'lng', 'minlat', 'minlng', 'maxlat', 'maxlng']);

const NAMES = '(?:lat|lng|minLat|minLng|maxLat|maxLng)';
const VALUE = '[^&#;\\s"\'<>]*';
/** Cheap test before any work: most strings hold no position. */
const HINT = /(?:lat|lng)=/i;
/** A position parameter followed by another one: drop it with its `&`, keep what is before. */
const NOT_LAST = new RegExp(`(^|[?&;])${NAMES}=${VALUE}&`, 'gi');
/** A position parameter that ends its query string: drop it with the separator before it. */
const LAST = new RegExp(`(?:^|[?&;])${NAMES}=${VALUE}`, 'gi');

export function isPositionParam(name: string): boolean {
  return POSITION_PARAMS.has(name.toLowerCase());
}

/**
 * Any text (a URL, a path with its query, a bare query string, a span name) without the
 * position parameters. Whatever the route, the spelling of the path or the case of the names:
 * the router is more tolerant than any list of routes kept here would be.
 */
export function stripPositionParams(text: string): string {
  if (!HINT.test(text)) return text;
  let out = text;
  // Two neighbours share one `&`, so one pass may uncover the next match.
  for (let i = 0; i < 8; i++) {
    const next = out.replace(NOT_LAST, '$1');
    if (next === out) break;
    out = next;
  }
  return out.replace(LAST, '');
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return stripPositionParams(value);
  if (depth > 12 || value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = walk(value[i], depth + 1, seen);
    return value;
  }
  if (!isPlainObject(value)) return value;
  for (const key of Object.keys(value)) {
    if (isPositionParam(key)) delete value[key];
    else value[key] = walk(value[key], depth + 1, seen);
  }
  return value;
}

/**
 * Drops the position from a Sentry payload (error event, span, breadcrumb) **in place** and
 * returns it: every string loses its position parameters, every `lat` / `lng` key goes.
 * In place because the SDK hands over its own object and events are large.
 */
export function scrubPosition<T>(payload: T): T {
  return walk(payload, 0, new WeakSet()) as T;
}
