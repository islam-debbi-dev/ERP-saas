import { type PayslipDto, PayType, type TenantSettingsResponse } from '@erp/shared';
import { layout, layoutPages } from './layout';
import { payslipPage } from './payslip';

const seller = {
  raisonSociale: 'SARL Test',
  adresse: 'Alger',
  telephone: null,
  rc: '16/00-1',
  nif: '0016',
  nis: '0017',
  ai: null,
  rib: null,
} as unknown as TenantSettingsResponse;

const slip = (over: Partial<PayslipDto> = {}): PayslipDto =>
  ({
    month: '2026-10',
    fullName: 'Karim <b>B',
    matricule: 'EMP-000001',
    position: 'Magasinier',
    nss: '1234',
    declared: true,
    payType: PayType.MONTHLY,
    gross: '60000.00',
    cotisable: '60000.00',
    taxable: '54600.00',
    cumulGross: '600000.00',
    cumulIrg: '90000.00',
    net: '45000.00',
    netToPay: '44000.00',
    days: {
      present: '26.0',
      leavePaid: 0,
      absentUnjustified: 0,
      absentJustified: 0,
      sick: 0,
      leaveUnpaid: 0,
      overtimeHours: '0.00',
    },
    lines: [
      {
        code: 'BASE_SALARY',
        label: 'Salaire de base',
        quantity: null,
        base: null,
        rate: null,
        amount: '60000.00',
        cotisable: true,
        imposable: true,
      },
      {
        code: 'CNAS_EMPLOYEE',
        label: 'Cotisation CNAS',
        quantity: null,
        base: '60000.00',
        rate: '0.09',
        amount: '-5400.00',
        cotisable: false,
        imposable: false,
      },
    ],
    ...over,
  }) as PayslipDto;

const run = {
  number: 'PAIE-2026-000001',
  approvedAt: '2026-11-02T10:00:00.000Z',
  toVerify: false,
  platformRates: false,
};

describe('payslip document', () => {
  it('prints a bulletin for a declared worker, with the company ids, NSS and cumuls', () => {
    const page = payslipPage(slip(), run, seller);
    const out = layout(page);
    expect(page.format).toBe('A4');
    expect(out).toContain('BULLETIN DE PAIE');
    expect(out).toContain('N° SS : 1234');
    expect(out).toContain('0016');
    expect(out).toContain('octobre 2026');
    expect(out).toContain('Cumul IRG');
  });

  it('never calls an undeclared worker’s document a bulletin', () => {
    const page = payslipPage(slip({ declared: false }), run, seller);
    const out = layout(page);
    expect(page.format).toBe('A5');
    expect(out).toContain('REÇU DE PAIE');
    expect(out).not.toContain('BULLETIN');
    expect(out).not.toContain('N° SS');
  });

  it('says so while the rates are not verified', () => {
    expect(layout(payslipPage(slip(), { ...run, toVerify: true }, seller))).toContain(
      'Taux à vérifier',
    );
    expect(layout(payslipPage(slip(), run, seller))).not.toContain('Taux à vérifier');
  });

  it("says the rates are the employer's, and when they are the platform's", () => {
    const own = layout(payslipPage(slip(), run, seller));
    expect(own).toContain('responsabilité de');
    expect(own).not.toContain('Taux indicatifs');
    expect(layout(payslipPage(slip(), { ...run, platformRates: true }, seller))).toContain(
      'Taux indicatifs de la plateforme',
    );
  });

  it('escapes names', () => {
    expect(layout(payslipPage(slip(), run, seller))).not.toContain('Karim <b>B');
  });

  it('puts each payslip on its own page in the bulk file', () => {
    const page = payslipPage(slip(), run, seller);
    const out = layoutPages([page, page]);
    expect(out.match(/<section class="page"/g)).toHaveLength(2);
    expect(out.match(/break-after: page/g)).toHaveLength(1);
    expect(out.match(/<body/g)).toHaveLength(1);
  });
});
