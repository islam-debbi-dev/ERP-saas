import { isPositionParam, stripPositionParams } from '@erp/shared';

/**
 * Phase 35: "Clients proches" sends the user's position as query parameters. It is used
 * for one query and never kept: the request log gets the URL without it.
 *
 * On every route and for every spelling: Express routes `/clients/nearby/` and
 * `/Clients/Nearby` to the same handler, so a list of paths here would always be behind
 * the router. The names and the rule live in `@erp/shared` (Sentry uses the same).
 */
export const stripPosition = stripPositionParams;

/** pino-http `req` serializer: receives the already serialized request. */
export function scrubRequest<T extends { url?: string; query?: Record<string, unknown> }>(
  req: T,
): T {
  const url = req.url === undefined ? undefined : stripPosition(req.url);
  const names = req.query ? Object.keys(req.query).filter(isPositionParam) : [];
  if (url === req.url && names.length === 0) return req;
  const query = { ...req.query };
  for (const name of names) delete query[name];
  return { ...req, ...(url === undefined ? {} : { url }), ...(req.query ? { query } : {}) };
}
