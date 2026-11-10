/**
 * Phase 35: "Clients proches" sends the user's position as query parameters. It is used
 * for one query and never kept: the request log gets the URL without `lat` / `lng`.
 */
const POSITION_ROUTES = /^\/clients\/nearby(?:\?|$)/;
const POSITION_PARAMS = ['lat', 'lng'];

/** The URL with the position parameters removed, for routes that carry one. */
export function stripPosition(url: string): string {
  if (!POSITION_ROUTES.test(url)) return url;
  const q = url.indexOf('?');
  if (q < 0) return url;
  const params = new URLSearchParams(url.slice(q + 1));
  for (const p of POSITION_PARAMS) params.delete(p);
  const rest = params.toString();
  return rest ? `${url.slice(0, q)}?${rest}` : url.slice(0, q);
}

/** pino-http `req` serializer: receives the already serialized request. */
export function scrubRequest<T extends { url?: string; query?: Record<string, unknown> }>(
  req: T,
): T {
  if (!req.url || !POSITION_ROUTES.test(req.url)) return req;
  const query = req.query ? { ...req.query } : undefined;
  if (query) for (const p of POSITION_PARAMS) delete query[p];
  return { ...req, url: stripPosition(req.url), ...(query ? { query } : {}) };
}
