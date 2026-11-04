import { type PayslipDto, PayType, type TenantSettingsResponse } from '@erp/shared';
import { da, html, quantity, rate, type SafeHtml } from './html';
import type { DocumentPage } from './layout';

const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

function monthLabel(month: string): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

function linesTable(slip: PayslipDto): SafeHtml {
  return html`<table class="lines">
    <thead>
      <tr>
        <th>Rubrique</th>
        <th class="num">Nombre</th>
        <th class="num">Base</th>
        <th class="num">Taux</th>
        <th class="num">Gain</th>
        <th class="num">Retenue</th>
      </tr>
    </thead>
    <tbody>
      ${slip.lines.map((l) => {
        const negative = l.amount.startsWith('-');
        return html`<tr>
          <td>${l.label}</td>
          <td class="num">${l.quantity ? quantity(l.quantity) : ''}</td>
          <td class="num">${l.base ? da(l.base) : ''}</td>
          <td class="num">${l.rate ? rate(l.rate) : ''}</td>
          <td class="num">${negative ? '' : da(l.amount)}</td>
          <td class="num">${negative ? da(l.amount.slice(1)) : ''}</td>
        </tr>`;
      })}
    </tbody>
  </table>`;
}

function daysLine(slip: PayslipDto): string {
  const d = slip.days;
  return [
    `Présence : ${d.present} j`,
    d.leavePaid ? `Congé payé : ${d.leavePaid} j` : '',
    d.absentUnjustified + d.absentJustified
      ? `Absences : ${d.absentUnjustified + d.absentJustified} j`
      : '',
    d.sick ? `Maladie : ${d.sick} j` : '',
    d.leaveUnpaid ? `Sans solde : ${d.leaveUnpaid} j` : '',
    d.overtimeHours !== '0.00' ? `Heures supp. : ${d.overtimeHours} h` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function bulletinBody(slip: PayslipDto, toVerify: boolean): SafeHtml {
  return html`${linesTable(slip)}
    <div class="after">
      <table class="totals">
        <tr>
          <td>Salaire brut</td>
          <td>${da(slip.gross)}</td>
        </tr>
        <tr>
          <td>Brut cotisable</td>
          <td>${da(slip.cotisable)}</td>
        </tr>
        <tr>
          <td>Imposable</td>
          <td>${da(slip.taxable)}</td>
        </tr>
        <tr>
          <td>Cumul brut de l'année</td>
          <td>${da(slip.cumulGross)}</td>
        </tr>
        <tr>
          <td>Cumul IRG de l'année</td>
          <td>${da(slip.cumulIrg)}</td>
        </tr>
      </table>
      <table class="totals">
        <tr>
          <td>Salaire net</td>
          <td>${da(slip.net)}</td>
        </tr>
        <tr class="grand">
          <td>Net à payer (DA)</td>
          <td>${da(slip.netToPay)}</td>
        </tr>
      </table>
    </div>
    <p class="note">${daysLine(slip)}</p>
    ${
      toVerify
        ? html`<p class="note">
            <b>Taux à vérifier</b> : barème non encore validé par un comptable.
          </p>`
        : ''
    }
    <div class="signatures">
      <div>L'employeur</div>
      <div>L'employé</div>
    </div>`;
}

function recuBody(slip: PayslipDto): SafeHtml {
  return html`${linesTable(slip)}
    <div class="after">
      <div></div>
      <table class="totals">
        <tr class="grand">
          <td>Net à payer (DA)</td>
          <td>${da(slip.netToPay)}</td>
        </tr>
      </table>
    </div>
    <p class="note">${daysLine(slip)}</p>
    <div class="signatures">
      <div>L'employeur</div>
      <div>Reçu par l'employé</div>
    </div>`;
}

/** A declared worker gets a bulletin; an undeclared one a reçu, never called a bulletin. */
export function payslipPage(
  slip: PayslipDto,
  run: { number: string | null; approvedAt: string | null; toVerify: boolean },
  seller: TenantSettingsResponse,
): DocumentPage {
  const declared = slip.declared;
  return {
    format: declared ? 'A4' : 'A5',
    title: declared ? 'BULLETIN DE PAIE' : 'REÇU DE PAIE',
    number: run.number,
    date: new Intl.DateTimeFormat('fr-DZ', {
      timeZone: 'Africa/Algiers',
      dateStyle: 'short',
    }).format(run.approvedAt ? new Date(run.approvedAt) : new Date()),
    seller,
    party: {
      label: 'Employé',
      name: slip.fullName,
      code: slip.matricule,
      lines: [
        slip.position ? `Poste : ${slip.position}` : null,
        declared && slip.nss ? `N° SS : ${slip.nss}` : null,
      ],
    },
    meta: [
      ['Période', monthLabel(slip.month)],
      ['Paiement', slip.payType === PayType.DAILY ? 'À la journée' : 'Au mois'],
    ],
    body: declared ? bulletinBody(slip, run.toVerify) : recuBody(slip),
    cancelled: false,
    duplicate: false,
  };
}
