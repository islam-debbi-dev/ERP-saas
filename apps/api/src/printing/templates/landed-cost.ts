/**
 * Fiche de coût de revient of a dossier d'importation (phase 22). An internal document
 * (costs and margins), in French like every print, always A4: the table is wide.
 */
import {
  type AllocationMethod,
  type ImportCostType,
  type ImportFileDto,
  ImportFileStatus,
  type LandedCostPreviewDto,
  money,
  toMoneyString,
} from '@erp/shared';
import { da, day, dayOf, html, quantity } from './html';
import { layout } from './layout';
import { type PrintContext } from './documents';

const COST_TYPES: Record<ImportCostType, string> = {
  FRET: 'Fret',
  DOUANE: 'Droits de douane',
  TVA_IMPORT: "TVA à l'importation",
  TRANSITAIRE: 'Transitaire',
  MAGASINAGE: 'Magasinage / port',
  TRANSPORT: 'Transport',
  ASSURANCE: 'Assurance',
  AUTRE: 'Autre',
};

const METHODS: Record<AllocationMethod, string> = {
  VALUE: 'Valeur',
  QUANTITY: 'Quantité',
  WEIGHT: 'Poids',
  VOLUME: 'Volume',
  MANUAL: 'Manuelle',
};

const STATUS: Record<ImportFileStatus, string> = {
  OPEN: 'Ouvert (prévisionnel)',
  CLOSED: 'Clôturé',
  CANCELLED: 'Annulé',
};

export function landedCostDocument(
  file: ImportFileDto,
  preview: LandedCostPreviewDto,
  ctx: PrintContext,
): string {
  const costs = file.costs.filter((c) => !c.cancelledAt);
  const body = html`
    <table class="lines">
      <thead>
        <tr>
          <th>Réf.</th>
          <th>Désignation</th>
          <th class="num">Qté</th>
          <th class="num">Valeur devise</th>
          <th class="num">Valeur DA</th>
          <th class="num">Frais</th>
          <th class="num">Total</th>
          <th class="num">Coût unitaire</th>
        </tr>
      </thead>
      <tbody>
        ${preview.lines.map((l) => {
          const fees = toMoneyString(money(l.landedTotal).minus(l.value));
          return html`<tr>
            <td>${l.reference}</td>
            <td>${l.designation}</td>
            <td class="num">${quantity(l.qtyBase)} ${l.baseUnitCode}</td>
            <td class="num">${l.valueCurrency ? `${da(l.valueCurrency)} ${l.currency}` : ''}</td>
            <td class="num">${da(l.value)}</td>
            <td class="num">${da(fees)}</td>
            <td class="num">${da(l.landedTotal)}</td>
            <td class="num">${l.landedUnitCost ? da(l.landedUnitCost) : ''}</td>
          </tr>`;
        })}
      </tbody>
    </table>
    <table class="lines" style="margin-top: 4mm">
      <thead>
        <tr>
          <th>Frais</th>
          <th>Fournisseur</th>
          <th class="num">Montant</th>
          <th class="num">TVA</th>
          <th class="num">Imputé</th>
          <th>Répartition</th>
        </tr>
      </thead>
      <tbody>
        ${costs.map(
          (c) =>
            html`<tr>
              <td>
                ${COST_TYPES[c.type]}${c.label ? ` – ${c.label}` : ''}${
                  c.isLate ? ` (tardif, ${dayOf(c.createdAt)})` : ''
                }
              </td>
              <td>${c.supplier?.name ?? ''}</td>
              <td class="num">
                ${da(c.amount)}${
                  c.amountCurrency
                    ? ` (${da(c.amountCurrency)} ${c.currency} × ${c.exchangeRate})`
                    : ''
                }
              </td>
              <td class="num">${da(c.tvaAmount)}</td>
              <td class="num">${da(c.allocated)}</td>
              <td>${METHODS[c.method]}</td>
            </tr>`,
        )}
      </tbody>
    </table>
    <table class="totals" style="margin-top: 4mm; margin-inline-start: auto">
      <tr>
        <td>Marchandises</td>
        <td class="num">${da(preview.totalGoods)}</td>
      </tr>
      <tr>
        <td>Frais imputés</td>
        <td class="num">${da(preview.totalCosts)}</td>
      </tr>
      <tr>
        <td><b>Coût de revient</b></td>
        <td class="num"><b>${da(preview.totalLanded)}</b></td>
      </tr>
    </table>
    ${file.note ? html`<p class="note">Note : ${file.note}</p>` : ''}
  `;
  const meta: [string, string][] = [['Statut', STATUS[file.status]]];
  if (file.reference) meta.push(['Référence', file.reference]);
  if (file.containerNo) meta.push(['Conteneur', file.containerNo]);
  if (file.arrivalDate) meta.push(['Arrivée', day(file.arrivalDate)]);
  meta.push(['Bons', file.purchases.map((p) => p.number ?? '').join(', ')]);

  return layout({
    format: 'A4',
    title: 'FICHE DE COÛT DE REVIENT',
    number: file.number,
    date: dayOf(file.closedAt ?? file.createdAt),
    seller: ctx.seller,
    party: null,
    meta,
    body,
    cancelled: file.status === ImportFileStatus.CANCELLED,
    duplicate: false,
  });
}
