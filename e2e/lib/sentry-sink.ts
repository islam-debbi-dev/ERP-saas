/**
 * A local stand-in for Sentry: an HTTP server that keeps every envelope it receives, so a
 * test can read what the app would have sent to a third party. Used with a fake DSN,
 * `http://t35@localhost:<port>/1`.
 *
 * Run alone (for the browser checks): `tsx lib/sentry-sink.ts 3099 /path/to/out.ndjson`
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { gunzipSync } from 'node:zlib';

export interface Sink {
  port: number;
  /** Every body received, decoded, in order. */
  bodies: string[];
  close(): Promise<void>;
}

export function startSink(port: number, file?: string): Promise<Sink> {
  const bodies: string[] = [];
  if (file) writeFileSync(file, '');
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      let buf = Buffer.concat(chunks);
      if (req.headers['content-encoding'] === 'gzip') {
        try {
          buf = gunzipSync(buf);
        } catch {
          /* keep the raw bytes */
        }
      }
      const body = buf.toString('utf8');
      if (body.length > 0) {
        bodies.push(body);
        if (file) appendFileSync(file, `${JSON.stringify({ url: req.url, body })}\n`);
      }
      // The browser SDK posts cross-origin.
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Content-Type': 'application/json',
      });
      res.end('{}');
    });
  });
  return new Promise((resolve) => {
    server.listen(port, () => {
      resolve({
        port,
        bodies,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

if (process.argv[1]?.endsWith('sentry-sink.ts')) {
  const port = Number(process.argv[2] ?? 3099);
  const file = process.argv[3];
  void startSink(port, file).then(() => console.log(`sentry sink on :${port}${file ? ` → ${file}` : ''}`));
}
