// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const web = join(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(join(web, path), 'utf8');

/** The comment lines of the header, without their ` * ` prefix. */
const header = read('../../packages/shared/src/communes.ts')
  .split('*/')[0]!
  .split('\n')
  .map((line) => line.replace(/^ \*( {3})?/, '').trimEnd());

describe('the licence of the communes data, served with the web app', () => {
  const served = read('public/licenses/algeria-communes-MIT.txt');

  it('holds the whole MIT notice of the data, word for word', () => {
    const from = header.indexOf('MIT License');
    const to = header.indexOf('SOFTWARE.');
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    expect(served).toContain(header.slice(from, to + 1).join('\n'));
  });

  it('names the same source and commit', () => {
    const sources = header.filter((line) => /(Source|Commit):/.test(line));
    expect(sources).toHaveLength(2);
    for (const line of sources) expect(served).toContain(line.trim());
  });
});
