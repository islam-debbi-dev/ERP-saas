/**
 * A local copy of the one rewrite of `apps/web/vercel.json`:
 *
 *   { "source": "/api/:path*", "destination": "https://<api>/:path*" }
 *
 * In production the browser calls the web project at `/api/clients/nearby?lat=…` and Vercel
 * forwards it to the API project at `/clients/nearby?lat=…`. This proxy does the same in
 * front of the local API and keeps the request lines it saw: that is what the **web**
 * project's request log would hold.
 */
import { createServer, request as httpRequest, type Server } from 'node:http';

export interface RewriteProxy {
  port: number;
  /** `METHOD url` of every request, as received (before the rewrite). */
  seen: string[];
  close(): Promise<void>;
}

export function startRewriteProxy(port: number, target: string): Promise<RewriteProxy> {
  const seen: string[] = [];
  const to = new URL(target);
  const server: Server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (!req.url?.startsWith('/api/')) {
      res.writeHead(404).end();
      return;
    }
    const upstream = httpRequest(
      {
        host: to.hostname,
        port: to.port,
        method: req.method,
        path: req.url.slice('/api'.length),
        headers: {
          ...req.headers,
          host: to.host,
          'x-forwarded-host': req.headers.host ?? '',
          'x-forwarded-for': '203.0.113.7',
        },
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('error', () => res.writeHead(502).end());
    req.pipe(upstream);
  });
  return new Promise((resolve) => {
    server.listen(port, () =>
      resolve({ port, seen, close: () => new Promise<void>((done) => server.close(() => done())) }),
    );
  });
}
