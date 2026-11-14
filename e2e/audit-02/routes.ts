/**
 * Audit 02: the list of API routes, read from the controllers (never written by hand).
 *
 *   pnpm exec tsx audit-02/routes.ts            (from e2e/)
 *
 * Writes artifacts/audit-02/routes.json and routes.md. Each route keeps the decorators
 * found on its handler (permissions, features, idempotency, throttle), which is what the
 * isolation and permission sweeps of part B start from.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { ARTIFACTS } from '../lib/config.ts';

export interface Route {
  verb: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  file: string;
  line: number;
  handler: string;
  /** Decorators on the class and on the handler, as written. */
  classDecorators: string[];
  decorators: string[];
}

const SRC = fileURLToPath(new URL('../../apps/api/src/', import.meta.url));
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'generated' && name !== 'node_modules') walk(p, out);
    } else if (/\.controllers?\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** Reads a balanced `( ... )` starting at `open` and returns its inside and its end. */
function balanced(src: string, open: number): { inside: string; end: number } {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return { inside: src.slice(open + 1, i), end: i + 1 };
    }
  }
  throw new Error('unbalanced parenthesis');
}

function firstString(arg: string): string {
  const m = /^\s*(['"`])([^'"`]*)\1/.exec(arg);
  if (m) return m[2]!;
  const obj = /path:\s*(['"`])([^'"`]*)\1/.exec(arg);
  return obj ? obj[2]! : '';
}

export function readRoutes(): Route[] {
  const routes: Route[] = [];
  for (const file of walk(SRC).sort()) {
    const src = readFileSync(file, 'utf8');
    const lineOf = (idx: number): number => src.slice(0, idx).split('\n').length;
    const deco = /@([A-Z][A-Za-z]*)\s*\(/g;
    let prefix = '';
    let classDecorators: string[] = [];
    let pending: { text: string; name: string; arg: string; idx: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = deco.exec(src))) {
      const name = m[1]!;
      const { inside, end } = balanced(src, m.index + m[0].length - 1);
      deco.lastIndex = end;
      // Parameter decorators (@Body(), @Param(), @Query()...) are not on the handler.
      if (
        /^(Body|Param|Query|Req|Res|Headers|Ip|CurrentUser|Tenant|UploadedFile|Inject|Optional)$/.test(
          name,
        )
      )
        continue;
      const after = src.slice(end);
      // @AdminController('x') is @Controller('admin/x') behind the super-admin guard.
      if (name === 'Controller' || name === 'AdminController') {
        prefix = name === 'AdminController' ? `admin/${firstString(inside)}` : firstString(inside);
        if (name === 'AdminController')
          pending.push({ text: '@AdminController()', name, arg: '', idx: m.index });
        classDecorators = pending.map((p) => p.text);
        // Decorators written after @Controller and before `export class` belong to the class too.
        pending = [];
        const cls = /^\s*((?:@[A-Z][\s\S]*?\)\s*)*)export\s+class/.exec(after);
        if (cls && cls[1])
          classDecorators.push(
            ...cls[1]
              .split(/\n/)
              .map((s) => s.trim())
              .filter(Boolean),
          );
        continue;
      }
      pending.push({
        text: `@${name}(${inside.replace(/\s+/g, ' ').trim()})`,
        name,
        arg: inside,
        idx: m.index,
      });
      // The handler starts when what follows the decorator is not another decorator.
      if (/^\s*@[A-Z]/.test(after)) continue;
      const verbDeco = pending.find((p) => /^(Get|Post|Put|Patch|Delete)$/.test(p.name));
      if (verbDeco) {
        const handler = /^\s*(?:public\s+|async\s+)*([A-Za-z0-9_]+)\s*\(/.exec(after)?.[1] ?? '?';
        const sub = firstString(verbDeco.arg);
        const path = `/${[prefix, sub].filter(Boolean).join('/')}`.replace(/\/+/g, '/');
        routes.push({
          verb: verbDeco.name.toUpperCase() as Route['verb'],
          path,
          file: relative(ROOT, file),
          line: lineOf(verbDeco.idx),
          handler,
          classDecorators: classDecorators.filter((d) => !d.startsWith('@Controller')),
          decorators: pending.filter((p) => p !== verbDeco).map((p) => p.text),
        });
      }
      pending = [];
    }
  }
  return routes;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const routes = readRoutes();
  const out = `${ARTIFACTS}audit-02/`;
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}routes.json`, JSON.stringify(routes, null, 2));
  const byFile = new Map<string, Route[]>();
  for (const r of routes) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);
  const md = [`# API routes (${routes.length}), read from the controllers`, ''];
  for (const [file, list] of byFile) {
    md.push(`## ${file}`, '');
    for (const r of list)
      md.push(`- \`${r.verb} ${r.path}\` (${r.handler}, line ${r.line}) ${r.decorators.join(' ')}`);
    md.push('');
  }
  writeFileSync(`${out}routes.md`, md.join('\n'));
  console.log(`${routes.length} routes in ${byFile.size} controller files`);
}
