// Builds src/communes.data.json from the syscli/algeria CSV files.
//
//   git clone https://github.com/syscli/algeria <dir>
//   git -C <dir> checkout 7789ea926e7c0751f33775ecf558fa026e2ee81b
//   node packages/shared/scripts/generate-communes.mjs <dir>/data
//
// The output depends only on the two CSV files: same input, same bytes.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const dataDir = process.argv[2];
if (!dataDir)
  throw new Error('usage: generate-communes.mjs <path to the data folder of syscli/algeria>');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') field += text[++i];
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  const [header, ...body] = rows;
  return body.map((cells) => {
    if (cells.length !== header.length) throw new Error(`bad CSV row: ${cells.join(',')}`);
    return Object.fromEntries(header.map((name, i) => [name, cells[i].trim()]));
  });
}

const read = (name) => parseCsv(readFileSync(join(dataDir, name), 'utf8').replace(/^\uFEFF/, ''));
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const slug = (name) =>
  name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const same = (a, b) => slug(a).replaceAll('-', '') === slug(b).replaceAll('-', '');

const rows = read('communes.csv')
  .map((r) => ({
    code: Number(r.code),
    wilaya: Number(r.wilaya_code),
    former: [...new Set([r.wilaya_code_58, r.wilaya_code_48].filter(Boolean).map(Number))].filter(
      (w) => w !== Number(r.wilaya_code),
    ),
    fr: r.name_fr,
    ar: r.name_ar,
    daira: r.daira_1991,
    aliases: r.aliases ? r.aliases.split('|').filter(Boolean) : [],
  }))
  .sort((a, b) => a.code - b.code);

// A daira is one (current wilaya, name) pair.
const dairas = new Map();
for (const row of rows) {
  if (!row.daira) {
    row.dairaKey = null;
    continue;
  }
  const key = `${String(row.wilaya).padStart(2, '0')}-${slug(row.daira)}`;
  const daira = dairas.get(key) ?? { key, wilaya: row.wilaya, fr: row.daira, members: [] };
  if (daira.fr !== row.daira) throw new Error(`two daira spellings for ${key}`);
  daira.members.push(row);
  dairas.set(key, daira);
  row.dairaKey = key;
}

// Arabic name of a daira: the Arabic name of its seat commune, only when there is one match.
// The seat is looked for among the daira's own communes, then in the whole country (a 1991
// daira can have its seat in another wilaya today).
function dairaArabicName(daira) {
  const isSeat = (row) => [row.fr, ...row.aliases].some((name) => same(name, daira.fr));
  const own = daira.members.filter(isSeat);
  const seats = own.length ? own : rows.filter(isSeat);
  return seats.length === 1 ? seats[0].ar : null;
}

const wilayas = read('wilayas.csv')
  .map((w) => [Number(w.code), w.name_fr, w.name_ar])
  .sort((a, b) => a[0] - b[0]);
const dairaRows = [...dairas.values()]
  .sort((a, b) => byText(a.key, b.key))
  .map((d) => [d.key, d.wilaya, d.fr, dairaArabicName(d)]);
const communeRows = rows.map((r) => [
  r.code,
  r.wilaya,
  r.former,
  r.fr,
  r.ar,
  r.dairaKey,
  r.aliases,
]);

// One record per line: compact, and a later change shows as a readable diff.
const list = (items) => `[\n${items.map((item) => JSON.stringify(item)).join(',\n')}\n]`;
const out = fileURLToPath(new URL('../src/communes.data.json', import.meta.url));
writeFileSync(
  out,
  `{"wilayas":${list(wilayas)},\n"dairas":${list(dairaRows)},\n"communes":${list(communeRows)}}\n`,
);

const unnamed = dairaRows.filter((d) => d[3] === null).map((d) => d[0]);
const report = (line) => process.stdout.write(`${line}\n`);
report(`${communeRows.length} communes, ${dairaRows.length} dairas`);
report(`dairas without an Arabic name: ${unnamed.join(', ') || 'none'}`);
report(
  `communes without a daira: ${
    rows
      .filter((r) => !r.dairaKey)
      .map((r) => r.code)
      .join(', ') || 'none'
  }`,
);
