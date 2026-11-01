/**
 * The printed documents. French only: they are legal documents (AGENTS.md §4).
 * Every value comes from the frozen data of the document (lines, client snapshot,
 * totals stored at validation), never from the current product or client.
 */
import {
  ClientLedgerType,
  type ClientDto,
  type ClientStatementDto,
  computeTotals,
  type OrderDto,
  OrderStatus,
  money,
  numberToFrenchWords,
  PaymentMode,
  PaymentStatus,
  PurchaseStatus,
  type PaymentDto,
  type PurchaseDto,
  type SaleDto,
  SaleStatus,
  type StockTransferDto,
  StockTransferStatus,
  StockTransferType,
  SaleType,
  type SupplierDto,
  SupplierLedgerType,
  type SupplierStatementDto,
  type TenantSettingsResponse,
  toMoneyString,
} from '@erp/shared';
import { da, dateTimeOf, day, dayOf, html, quantity, rate, type SafeHtml } from './html';
import { clientLegal, type DocumentPage, layout, type PartyBlock } from './layout';

export interface PrintContext {
  seller: TenantSettingsResponse;
  format: DocumentPage['format'];
  duplicate: boolean;
}

interface PrintLine {
  designation: string;
  qty: string;
  unit: string;
  unitPriceHt: string;
  discountPct: string;
  tvaRate: string;
  lineHt: string;
}

const PAYMENT_MODES: Record<string, string> = {
  [PaymentMode.ESPECES]: 'Espèces',
  [PaymentMode.CHEQUE]: 'Chèque',
  [PaymentMode.VIREMENT]: 'Virement',
};

/** Default units are stored as codes (translated in the UI); custom units have a name. */
const UNIT_NAMES: Record<string, string> = {
  PIECE: 'Pièce',
  KG: 'Kg',
  LITRE: 'Litre',
  METRE: 'Mètre',
  CARTON: 'Carton',
  FARDEAU: 'Fardeau',
  SAC: 'Sac',
  BOITE: 'Boîte',
  PAQUET: 'Paquet',
};
const unitLabel = (l: { unitName: string | null; unitCode: string }): string =>
  l.unitName ?? UNIT_NAMES[l.unitCode] ?? l.unitCode;

const LEDGER_TYPES: Record<string, string> = {
  [ClientLedgerType.OPENING]: "Solde d'ouverture",
  [ClientLedgerType.SALE]: 'Vente',
  [ClientLedgerType.PAYMENT]: 'Versement',
  [ClientLedgerType.RETURN]: 'Avoir',
  [ClientLedgerType.ADJUSTMENT]: 'Ajustement',
  [ClientLedgerType.REVERSAL]: 'Annulation',
};

const SUPPLIER_LEDGER_TYPES: Record<string, string> = {
  [SupplierLedgerType.OPENING]: "Solde d'ouverture",
  [SupplierLedgerType.PURCHASE]: 'Achat',
  [SupplierLedgerType.PAYMENT]: 'Règlement',
  [SupplierLedgerType.RETURN]: 'Retour',
  [SupplierLedgerType.ADJUST]: 'Ajustement',
  [SupplierLedgerType.REVERSAL]: 'Annulation',
};

/** Ledger reasons stored as codes, printed in French. */
const LEDGER_REASONS: Record<string, string> = {
  paid_at_reception: 'payé à la réception',
};

function linesTable(lines: PrintLine[], withTva: boolean): SafeHtml {
  const withDiscount = lines.some((l) => !money(l.discountPct).isZero());
  return html`<table class="lines">
    <thead>
      <tr>
        <th class="center">N°</th>
        <th>Désignation</th>
        <th class="num">Qté</th>
        <th>Unité</th>
        <th class="num">P.U. HT</th>
        ${withDiscount ? html`<th class="num">Remise %</th>` : ''}
        ${withTva ? html`<th class="num">TVA %</th>` : ''}
        <th class="num">Montant HT</th>
      </tr>
    </thead>
    <tbody>
      ${lines.map(
        (l, i) =>
          html`<tr>
            <td class="center">${i + 1}</td>
            <td>${l.designation}</td>
            <td class="num">${quantity(l.qty)}</td>
            <td>${l.unit}</td>
            <td class="num">${da(l.unitPriceHt)}</td>
            ${withDiscount ? html`<td class="num">${rate(l.discountPct)}</td>` : ''}
            ${withTva ? html`<td class="num">${rate(l.tvaRate)}</td>` : ''}
            <td class="num">${da(l.lineHt)}</td>
          </tr>`,
      )}
    </tbody>
  </table>`;
}

type TotalRow = [label: string, amount: string, grand?: boolean];

function totalsTable(rows: TotalRow[]): SafeHtml {
  return html`<table class="totals">
    ${rows.map(
      ([label, amount, grand]) =>
        html`<tr class="${grand ? 'grand' : ''}">
          <td>${label}</td>
          <td>${da(amount)} DA</td>
        </tr>`,
    )}
  </table>`;
}

/** HT, TVA per rate and TTC (or a single total for a non-assujetti tenant). */
function taxRows(
  doc: {
    assujettiTva: boolean;
    totalHt: string;
    totalTtc: string;
    tvaByRate: { rate: string; tva: string }[];
  },
  grandLabel: string,
  grand: boolean,
): TotalRow[] {
  // Non assujetti: HT = TTC, a single "Total" (no TTC wording on a document without TVA).
  if (!doc.assujettiTva) return [[grandLabel.replace(' TTC', ''), doc.totalTtc, grand]];
  return [
    ['Total HT', doc.totalHt],
    ...doc.tvaByRate.map((r): TotalRow => [`TVA ${rate(r.rate)} %`, r.tva]),
    [grandLabel, doc.totalTtc, grand],
  ];
}

function words(intro: string, amount: string): SafeHtml {
  return html`<p class="words">${intro} : <b>${capitalize(numberToFrenchWords(amount))}</b>.</p>`;
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function tvaMention(assujetti: boolean, seller: TenantSettingsResponse): SafeHtml | string {
  return assujetti ? '' : html`<p class="mention">${seller.tvaMention}</p>`;
}

function clientParty(snapshot: SaleDto['clientSnapshot'], fallback: SaleDto['client']): PartyBlock {
  if (!snapshot) {
    return fallback
      ? { label: 'Client', name: fallback.name, code: fallback.code, lines: [] }
      : { label: 'Client', name: 'Client comptoir', lines: [] };
  }
  return {
    label: 'Client',
    name: snapshot.name,
    code: snapshot.code,
    lines: [
      snapshot.address,
      [snapshot.commune, snapshot.wilaya].filter(Boolean).join(', ') || null,
      snapshot.phone ? `Tél. : ${snapshot.phone}` : null,
    ],
    legal: clientLegal(snapshot),
  };
}

// ---------------------------------------------------------------- BL & facture

export function saleDocument(sale: SaleDto, ctx: PrintContext): string {
  const facture = sale.type === SaleType.FACTURE;
  const due = toMoneyString(money(sale.totalTtc).plus(sale.timbre));
  const rest = money(due).minus(sale.paidAmount);
  const hasTimbre = money(sale.timbre).gt(0);

  const rows = taxRows(sale, 'Total TTC', !hasTimbre);
  if (hasTimbre) rows.push(['Timbre fiscal', sale.timbre], ['Net à payer', due, true]);
  if (money(sale.paidAmount).gt(0)) {
    rows.push(['Montant versé', sale.paidAmount]);
    if (rest.gt(0)) rows.push(['Reste à payer', toMoneyString(rest)]);
  }

  const meta: [string, string][] = [];
  if (facture) {
    meta.push([
      'Mode de paiement',
      sale.paymentMode ? (PAYMENT_MODES[sale.paymentMode] ?? sale.paymentMode) : 'À terme',
    ]);
  }
  if (sale.sourceBls.length > 0) {
    meta.push(['Bons de livraison', sale.sourceBls.map((b) => b.number ?? '').join(', ')]);
  }
  if (sale.invoice?.number) meta.push(['Facturé par', sale.invoice.number]);

  const body = html`
    ${linesTable(
      sale.lines.map((l) => ({ ...l, unit: unitLabel(l) })),
      sale.assujettiTva,
    )}
    <div class="after">
      <div>${tvaMention(sale.assujettiTva, ctx.seller)}</div>
      ${totalsTable(rows)}
    </div>
    ${facture ? words('Arrêtée la présente facture à la somme de', due) : ''}
    ${sale.note ? html`<p class="note">Note : ${sale.note}</p>` : ''}
    <div class="signatures">
      <div>Le client</div>
      <div>Cachet et signature</div>
    </div>
  `;

  return layout({
    format: ctx.format,
    title: facture ? 'FACTURE' : 'BON DE LIVRAISON',
    number: sale.number,
    date: day(sale.documentDate),
    seller: ctx.seller,
    party: clientParty(sale.clientSnapshot, sale.client),
    meta,
    body,
    cancelled: sale.status === SaleStatus.CANCELLED,
    duplicate: ctx.duplicate,
  });
}

// ---------------------------------------------------------------- avoir

export function avoirDocument(sale: SaleDto, returnId: string, ctx: PrintContext): string {
  const avoir = sale.returns.find((r) => r.id === returnId);
  if (!avoir) throw new Error(`avoirDocument: return ${returnId} is not on sale ${sale.id}`);
  const byLine = new Map(sale.lines.map((l) => [l.id, l]));
  const lines: PrintLine[] = avoir.lines.map((rl) => {
    const l = byLine.get(rl.saleLineId);
    return {
      designation: l?.designation ?? '',
      unit: l ? unitLabel(l) : '',
      qty: rl.qty,
      unitPriceHt: rl.unitPriceHt,
      discountPct: rl.discountPct,
      tvaRate: rl.tvaRate,
      lineHt: rl.lineHt,
    };
  });
  // Same rounding as when the avoir was made: TVA once per rate on the summed HT.
  const totals = computeTotals(
    lines.map((l) => ({
      qty: l.qty,
      unitPrice: l.unitPriceHt,
      tvaRate: l.tvaRate,
      discountPct: l.discountPct,
    })),
    sale.assujettiTva,
  );
  const tvaByRate = totals.tvaByRate.map((r) => ({
    rate: r.rate.toString(),
    tva: toMoneyString(r.tva),
  }));

  const body = html`
    ${linesTable(lines, sale.assujettiTva)}
    <div class="after">
      <div>${tvaMention(sale.assujettiTva, ctx.seller)}</div>
      ${totalsTable(
        taxRows(
          {
            assujettiTva: sale.assujettiTva,
            totalHt: avoir.totalHt,
            totalTtc: avoir.totalTtc,
            tvaByRate,
          },
          'Total avoir TTC',
          true,
        ),
      )}
    </div>
    ${words('Arrêté le présent avoir à la somme de', avoir.totalTtc)}
    <div class="signatures">
      <div>Le client</div>
      <div>Cachet et signature</div>
    </div>
  `;

  return layout({
    format: ctx.format,
    title: 'AVOIR',
    number: avoir.number,
    date: dayOf(avoir.createdAt),
    seller: ctx.seller,
    party: clientParty(sale.clientSnapshot, sale.client),
    meta: [
      [
        sale.type === SaleType.FACTURE ? 'Sur facture' : 'Sur bon de livraison',
        `${sale.number ?? ''} du ${day(sale.documentDate)}`,
      ],
      ['Motif', avoir.reason],
    ],
    body,
    cancelled: false,
    duplicate: ctx.duplicate,
  });
}

// ---------------------------------------------------------------- bon de réception

export function purchaseDocument(p: PurchaseDto, ctx: PrintContext): string {
  const lines: PrintLine[] = p.lines.map((l) => ({
    designation: l.designation,
    unit: unitLabel(l),
    qty: l.qty,
    unitPriceHt: l.unitCost,
    discountPct: '0',
    tvaRate: l.tvaRate,
    lineHt: l.lineHt,
  }));
  const rows = taxRows({ ...p, assujettiTva: true }, 'Total TTC', true);
  if (money(p.paidAmount).gt(0)) rows.push(['Montant payé', p.paidAmount]);

  const body = html`
    ${linesTable(lines, true)}
    <div class="after">
      <div></div>
      ${totalsTable(rows)}
    </div>
    ${p.note ? html`<p class="note">Note : ${p.note}</p>` : ''}
    <div class="signatures">
      <div>Le magasinier</div>
      <div>Visa</div>
    </div>
  `;
  const meta: [string, string][] = [];
  if (p.supplierRef) meta.push(['Réf. fournisseur', p.supplierRef]);

  return layout({
    format: ctx.format,
    title: 'BON DE RÉCEPTION',
    number: p.number,
    date: day(p.documentDate),
    seller: ctx.seller,
    party: { label: 'Fournisseur', name: p.supplier.name, lines: [] },
    meta,
    body,
    cancelled: p.status === PurchaseStatus.CANCELLED,
    duplicate: ctx.duplicate,
  });
}

// ---------------------------------------------------------------- bon de chargement

const TRANSFER_TITLES: Record<StockTransferType, string> = {
  [StockTransferType.LOAD]: 'BON DE CHARGEMENT',
  [StockTransferType.UNLOAD]: 'BON DE DÉCHARGEMENT',
  [StockTransferType.TRANSFER]: 'BON DE TRANSFERT',
};

/** Quantities only: a transfer moves goods at cost, it has no price for the driver. */
export function transferDocument(t: StockTransferDto, ctx: PrintContext): string {
  const body = html`
    <table class="lines">
      <thead>
        <tr>
          <th>Réf.</th>
          <th>Désignation</th>
          <th>Unité</th>
          <th class="num">Quantité</th>
        </tr>
      </thead>
      <tbody>
        ${t.lines.map(
          (l) =>
            html`<tr>
              <td>${l.reference}</td>
              <td>${l.designation}</td>
              <td>${UNIT_NAMES[l.unitCode] ?? l.unitCode}</td>
              <td class="num">${quantity(l.qty)}</td>
            </tr>`,
        )}
      </tbody>
    </table>
    ${t.note ? html`<p class="note">Note : ${t.note}</p>` : ''}
    <div class="signatures">
      <div>Le magasinier</div>
      <div>
        ${t.type === StockTransferType.TRANSFER ? 'Le réceptionnaire' : 'Le chauffeur / vendeur'}
      </div>
    </div>
  `;
  return layout({
    format: ctx.format,
    title: TRANSFER_TITLES[t.type],
    number: t.number,
    date: dayOf(t.validatedAt ?? t.createdAt),
    seller: ctx.seller,
    party: null,
    meta: [
      ['De', t.from.name],
      ['Vers', t.to.name],
      ['Lignes', String(t.lines.length)],
    ],
    body,
    cancelled: t.status === StockTransferStatus.CANCELLED,
    duplicate: ctx.duplicate,
  });
}

// ---------------------------------------------------------------- bon de commande

/**
 * Bon de commande (phase 16): what the client ordered at the prices frozen at
 * confirmation. Not a sale: no payment, no amount in words. Once delivered, the
 * quantities not delivered are shown.
 */
export function orderDocument(o: OrderDto, ctx: PrintContext): string {
  const totals = computeTotals(
    o.lines.map((l) => ({
      qty: l.qty,
      unitPrice: l.unitPriceHt,
      tvaRate: l.tvaRate,
      discountPct: l.discountPct,
    })),
    o.assujettiTva,
  );
  const rows = taxRows(
    {
      assujettiTva: o.assujettiTva,
      totalHt: o.totalHt,
      totalTtc: o.totalTtc,
      tvaByRate: totals.tvaByRate.map((r) => ({
        rate: r.rate.toFixed(2),
        tva: toMoneyString(r.tva),
      })),
    },
    'Total TTC',
    true,
  );
  const short = o.lines.filter((l) => l.qtyNotDelivered && money(l.qtyNotDelivered).gt(0));
  const meta: [string, string][] = [];
  if (o.seller) meta.push(['Vendeur', o.seller.fullName]);
  if (o.requestedDate) meta.push(['Livraison prévue', day(o.requestedDate)]);
  if (o.sale?.number) meta.push(['Livré par', o.sale.number]);
  const body = html`
    ${linesTable(
      o.lines.map((l) => ({ ...l, unit: UNIT_NAMES[l.unitCode] ?? l.unitCode })),
      o.assujettiTva,
    )}
    <div class="after">
      <div>${tvaMention(o.assujettiTva, ctx.seller)}</div>
      ${totalsTable(rows)}
    </div>
    ${
      short.length > 0
        ? html`<p class="note">
            Non livré :
            ${short
              .map((l) => `${l.designation} (${quantity(l.qtyNotDelivered ?? '0')})`)
              .join(', ')}
          </p>`
        : ''
    }
    ${o.note ? html`<p class="note">Note : ${o.note}</p>` : ''}
    <div class="signatures">
      <div>Le client</div>
      <div>Le vendeur</div>
    </div>
  `;
  return layout({
    format: ctx.format,
    title: 'BON DE COMMANDE',
    number: o.number,
    date: dayOf(o.confirmedAt ?? o.createdAt),
    seller: ctx.seller,
    party: {
      label: 'Client',
      name: o.client.name,
      code: o.client.code,
      lines: [o.client.phone ? `Tél. : ${o.client.phone}` : null],
    },
    meta,
    body,
    cancelled: o.status === OrderStatus.CANCELLED,
    duplicate: ctx.duplicate,
  });
}

// ---------------------------------------------------------------- relevé de compte

type StatementLike = Pick<
  ClientStatementDto,
  'from' | 'openingBalance' | 'closingBalance' | 'totalDebit' | 'totalCredit'
> & {
  entries: {
    type: string;
    amount: string;
    label: string;
    reason: string | null;
    createdAt: string;
    runningBalance: string;
  }[];
};

/** The table of a relevé: opening line, entries with running balance, totals. */
function statementBody(
  st: StatementLike,
  types: Record<string, string>,
  creditLabel: string,
): SafeHtml {
  const debitCredit = (amount: string) => {
    const a = money(amount);
    return a.gte(0) ? [da(amount), ''] : ['', da(a.abs().toString())];
  };
  return html`
    <table class="lines">
      <thead>
        <tr>
          <th>Date</th>
          <th>Opération</th>
          <th>Libellé</th>
          <th class="num">Débit</th>
          <th class="num">Crédit</th>
          <th class="num">Solde</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${day(st.from)}</td>
          <td colspan="4">Solde au ${day(st.from)}</td>
          <td class="num">${da(st.openingBalance)}</td>
        </tr>
        ${st.entries.map((e) => {
          const [debit, credit] = debitCredit(e.amount);
          return html`<tr>
            <td>${dayOf(e.createdAt)}</td>
            <td>${types[e.type] ?? e.type}</td>
            <td>${e.label}${e.reason ? html` — ${LEDGER_REASONS[e.reason] ?? e.reason}` : ''}</td>
            <td class="num">${debit}</td>
            <td class="num">${credit}</td>
            <td class="num">${da(e.runningBalance)}</td>
          </tr>`;
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="3">Totaux de la période</td>
          <td class="num">${da(st.totalDebit)}</td>
          <td class="num">${da(st.totalCredit)}</td>
          <td class="num">${da(st.closingBalance)}</td>
        </tr>
      </tfoot>
    </table>
    <div class="after">
      <div></div>
      ${totalsTable([
        ['Solde initial', st.openingBalance],
        ['Total débit', st.totalDebit],
        ['Total crédit', st.totalCredit],
        [
          money(st.closingBalance).lt(0) ? creditLabel : 'Solde dû',
          money(st.closingBalance).abs().toFixed(2),
          true,
        ],
      ])}
    </div>
  `;
}

export function statementDocument(
  st: ClientStatementDto,
  client: ClientDto,
  ctx: Omit<PrintContext, 'duplicate'>,
): string {
  const body = statementBody(st, LEDGER_TYPES, 'Solde en faveur du client');

  return layout({
    format: ctx.format,
    title: 'RELEVÉ DE COMPTE',
    number: null,
    date: dayOf(new Date().toISOString()),
    seller: ctx.seller,
    party: {
      label: 'Client',
      name: client.name,
      code: client.code,
      lines: [
        client.address,
        [client.commune, client.wilaya].filter(Boolean).join(', ') || null,
        client.phone ? `Tél. : ${client.phone}` : null,
      ],
      legal: clientLegal(client),
    },
    meta: [['Période', `du ${day(st.from)} au ${day(st.to)}`]],
    body,
    cancelled: false,
    duplicate: false,
  });
}

/** Relevé fournisseur (phase 21): what we owe the supplier, entry by entry. */
export function supplierStatementDocument(
  st: SupplierStatementDto,
  supplier: SupplierDto,
  ctx: Omit<PrintContext, 'duplicate'>,
): string {
  // Phase 22: a foreign supplier's statement shows its currency next to the DZD.
  const cur = st.supplier.currency;
  const foreign = cur !== 'DZD';
  const meta: [string, string][] = [['Période', `du ${day(st.from)} au ${day(st.to)}`]];
  if (foreign) {
    meta.push(
      ['Devise', cur],
      [`Solde initial (${cur})`, da(st.openingBalanceCurrency)],
      [`Solde final (${cur})`, da(st.closingBalanceCurrency)],
    );
  }
  const shown = foreign
    ? {
        ...st,
        entries: st.entries.map((e) =>
          e.amountCurrency ? { ...e, label: `${e.label} (${da(e.amountCurrency)} ${cur})` } : e,
        ),
      }
    : st;
  return layout({
    format: ctx.format,
    title: 'RELEVÉ FOURNISSEUR',
    number: null,
    date: dayOf(new Date().toISOString()),
    seller: ctx.seller,
    party: {
      label: 'Fournisseur',
      name: supplier.name,
      code: supplier.code,
      lines: [supplier.address, supplier.phone ? `Tél. : ${supplier.phone}` : null],
      legal: clientLegal(supplier),
    },
    meta,
    body: statementBody(shown, SUPPLIER_LEDGER_TYPES, 'Solde en notre faveur'),
    cancelled: false,
    duplicate: false,
  });
}

// ---------------------------------------------------------------- reçu de versement

export function receiptDocument(p: PaymentDto, ctx: PrintContext): string {
  const meta: [string, string][] = [['Mode', PAYMENT_MODES[p.mode] ?? p.mode]];
  if (p.reference)
    meta.push([p.mode === PaymentMode.CHEQUE ? 'Chèque n°' : 'Référence', p.reference]);
  if (p.bank) meta.push(['Banque', p.bank]);
  if (p.dueDate) meta.push(['Échéance', day(p.dueDate)]);
  if (p.receivedBy) meta.push(['Reçu par', p.receivedBy.fullName]);

  const body = html`
    <p class="big">Montant : ${da(p.amount)} DA</p>
    ${words('Reçu la somme de', p.amount)}
    ${
      p.allocations.length > 0
        ? html`<table class="lines">
            <thead>
              <tr>
                <th>Document réglé</th>
                <th class="num">Montant</th>
              </tr>
            </thead>
            <tbody>
              ${p.allocations.map(
                (a) =>
                  html`<tr>
                    <td>
                      ${a.saleType === SaleType.FACTURE ? 'Facture' : 'BL'} ${a.saleNumber ?? ''}
                    </td>
                    <td class="num">${da(a.amount)}</td>
                  </tr>`,
              )}
            </tbody>
          </table>`
        : ''
    }
    ${p.note ? html`<p class="note">Note : ${p.note}</p>` : ''}
    <p class="note">Reçu le ${dateTimeOf(p.receivedAt)}</p>
    <div class="signatures">
      <div>Le client</div>
      <div>Le caissier</div>
    </div>
  `;

  const party: PartyBlock | null = p.client
    ? { label: 'Reçu de', name: p.client.name, code: p.client.code, lines: [] }
    : null;

  return layout({
    format: ctx.format,
    title: 'REÇU DE VERSEMENT',
    number: p.number,
    date: dayOf(p.receivedAt),
    seller: ctx.seller,
    party,
    meta,
    body,
    cancelled: p.status !== PaymentStatus.VALID,
    cancelledLabel: p.status === PaymentStatus.BOUNCED ? 'IMPAYÉ' : undefined,
    duplicate: ctx.duplicate,
  });
}
