import { ClientType, type PrintFormat, type TenantSettingsResponse } from '@erp/shared';
import { html, SafeHtml } from './html';

/** The other party: client (sales, relevé, reçu) or supplier (bon de réception). */
export interface PartyBlock {
  label: string;
  name: string;
  code?: string | null;
  lines: (string | null | undefined)[];
  /** RC / NIF / NIS / AI, printed for professionals only. */
  legal?: { rc: string | null; nif: string | null; nis: string | null; ai: string | null };
}

export interface DocumentPage {
  format: PrintFormat;
  /** "FACTURE", "BON DE LIVRAISON"… */
  title: string;
  number: string | null;
  date: string;
  seller: TenantSettingsResponse;
  party: PartyBlock | null;
  /** Extra header rows (payment mode, source BLs, période…). */
  meta: [string, string][];
  body: SafeHtml;
  cancelled: boolean;
  /** Label replacing ANNULÉ for a bounced cheque. */
  cancelledLabel?: string;
  duplicate: boolean;
}

/** Client legal IDs are printed for professionals (old snapshots have no type: print if set). */
export function clientLegal(c: {
  type?: string | null;
  rc: string | null;
  nif: string | null;
  nis: string | null;
  ai: string | null;
}): PartyBlock['legal'] {
  const any = Boolean(c.rc || c.nif || c.nis || c.ai);
  const pro = c.type ? c.type === ClientType.PROFESSIONNEL : any;
  return pro && any ? { rc: c.rc, nif: c.nif, nis: c.nis, ai: c.ai } : undefined;
}

function legalIds(ids: {
  rc: string | null;
  nif: string | null;
  nis: string | null;
  ai: string | null;
}) {
  const rows: [string, string | null][] = [
    ['RC', ids.rc],
    ['NIF', ids.nif],
    ['NIS', ids.nis],
    ['AI', ids.ai],
  ];
  return rows
    .filter((r): r is [string, string] => Boolean(r[1]))
    .map(([k, v]) => html`<span class="id"><b>${k}</b> ${v}</span>`);
}

// A constant stylesheet, inserted as is (never built from data).
const CSS = new SafeHtml(`
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: 'DejaVu Sans', 'Noto Sans', Arial, Helvetica, 'Open Sans', 'Noto Naskh Arabic', sans-serif;
  color: #111; font-size: var(--fs); line-height: 1.35;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.A4 { --fs: 9.5pt; --fs-title: 15pt; --fs-small: 8pt; }
.A5 { --fs: 7.8pt; --fs-title: 12pt; --fs-small: 6.8pt; }
header { display: flex; justify-content: space-between; gap: 6mm; border-bottom: 1.5pt solid #111; padding-bottom: 3mm; }
.seller h1 { font-size: calc(var(--fs) * 1.45); margin: 0 0 1mm; }
.seller p, .party p { margin: 0; }
.ids { margin-top: 1mm; font-size: var(--fs-small); display: flex; flex-wrap: wrap; gap: 0 3mm; }
.doc { text-align: end; min-width: 40%; }
.doc .title { font-size: var(--fs-title); font-weight: 700; letter-spacing: 0.5pt; }
.doc .number { font-size: calc(var(--fs) * 1.2); font-weight: 700; margin-top: 1mm; }
.doc .dup { display: inline-block; margin-top: 1mm; border: 1pt solid #111; padding: 0.3mm 2mm; font-weight: 700; font-size: var(--fs-small); letter-spacing: 1pt; }
.top { display: flex; justify-content: space-between; gap: 6mm; margin: 3mm 0; }
.party { border: 0.8pt solid #444; border-radius: 1.5mm; padding: 2mm 3mm; min-width: 48%; }
.party .label { font-size: var(--fs-small); text-transform: uppercase; color: #444; }
.party .name { font-weight: 700; }
.meta { border-collapse: collapse; font-size: var(--fs); align-self: flex-start; }
.meta td { padding: 0.4mm 0 0.4mm 3mm; }
.meta td:first-child { color: #444; padding-left: 0; }
table.lines { width: 100%; border-collapse: collapse; margin-top: 2mm; }
table.lines th { background: #eee; border: 0.6pt solid #888; padding: 1.2mm 1.5mm; font-size: var(--fs-small); text-transform: uppercase; }
table.lines td { border-left: 0.6pt solid #888; border-right: 0.6pt solid #888; padding: 1mm 1.5mm; vertical-align: top; }
table.lines tbody tr:last-child td { border-bottom: 0.6pt solid #888; }
table.lines tr { break-inside: avoid; }
table.lines tfoot td { border: 0.6pt solid #888; font-weight: 700; }
.num { text-align: end; white-space: nowrap; font-variant-numeric: tabular-nums; }
.center { text-align: center; }
.after { display: flex; justify-content: space-between; gap: 6mm; margin-top: 3mm; break-inside: avoid; }
.totals { border-collapse: collapse; min-width: 45%; margin-inline-start: auto; }
.totals td { border: 0.6pt solid #888; padding: 1mm 2mm; }
.totals td:last-child { text-align: end; white-space: nowrap; font-variant-numeric: tabular-nums; }
.totals tr.grand td { font-weight: 700; background: #eee; font-size: calc(var(--fs) * 1.1); }
.words { margin-top: 3mm; break-inside: avoid; }
.words b { font-weight: 700; }
.mention { margin-top: 2mm; font-style: italic; }
.note { margin-top: 2mm; font-size: var(--fs-small); }
.signatures { display: flex; justify-content: space-between; margin-top: 8mm; break-inside: avoid; }
.signatures div { width: 40%; text-align: center; border-top: 0.6pt dashed #666; padding-top: 1mm; font-size: var(--fs-small); }
.big { font-size: calc(var(--fs) * 1.6); font-weight: 700; }
.watermark {
  position: fixed; top: 45%; left: 0; right: 0; text-align: center;
  transform: rotate(-30deg); font-size: 80pt; font-weight: 700; letter-spacing: 6pt;
  color: rgba(200, 0, 0, 0.18); z-index: 10; pointer-events: none;
}
.A5 .watermark { font-size: 52pt; }
`);

export function layout(p: DocumentPage): string {
  const s = p.seller;
  const watermark = p.cancelled ? (p.cancelledLabel ?? 'ANNULÉ') : null;
  return html`<!doctype html>
    <html lang="fr">
      <head>
        <meta charset="utf-8" />
        <title>${p.title} ${p.number ?? ''}</title>
        <style>
          ${CSS}
        </style>
      </head>
      <body class="${p.format}">
        ${watermark ? html`<div class="watermark">${watermark}</div>` : ''}
        <header>
          <div class="seller">
            <h1>${s.raisonSociale}</h1>
            ${s.adresse ? html`<p>${s.adresse}</p>` : ''}
            ${s.telephone ? html`<p>Tél. : ${s.telephone}</p>` : ''}
            <div class="ids">
              ${legalIds(s)} ${s.rib ? html`<span class="id"><b>RIB</b> ${s.rib}</span>` : ''}
            </div>
          </div>
          <div class="doc">
            <div class="title">${p.title}</div>
            ${p.number ? html`<div class="number">N° ${p.number}</div>` : ''}
            <div>Date : ${p.date}</div>
            ${p.duplicate ? html`<div class="dup">DUPLICATA</div>` : ''}
          </div>
        </header>
        <div class="top">
          ${
            p.party
              ? html`<div class="party">
                  <div class="label">${p.party.label}</div>
                  <p class="name">
                    ${p.party.name}${p.party.code ? html` <span>(${p.party.code})</span>` : ''}
                  </p>
                  ${p.party.lines.filter(Boolean).map((l) => html`<p>${l}</p>`)}
                  ${p.party.legal ? html`<div class="ids">${legalIds(p.party.legal)}</div>` : ''}
                </div>`
              : html`<div></div>`
          }
          ${
            p.meta.length > 0
              ? html`<table class="meta">
                  ${p.meta.map(
                    ([k, v]) =>
                      html`<tr>
                        <td>${k}</td>
                        <td>${v}</td>
                      </tr>`,
                  )}
                </table>`
              : ''
          }
        </div>
        ${p.body}
      </body>
    </html>`.value;
}
