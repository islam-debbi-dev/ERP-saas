import { employeeAuditDiff, type EmployeeAuditRow } from './employee-audit';

const row: EmployeeAuditRow = {
  fullName: 'Karim',
  phone: null,
  position: 'Magasinier',
  warehouseId: 'w1',
  userId: null,
  hireDate: new Date('2026-11-06T00:00:00.000Z'),
  exitDate: null,
  contract: 'CDI',
  contractEndDate: null,
  declared: true,
  nss: null,
  nin: null,
  birthDate: null,
  restDays: [5],
};

describe('employeeAuditDiff', () => {
  it('lists only the fields that changed, dates as days', () => {
    const after = { ...row, hireDate: new Date('2026-10-27T00:00:00.000Z'), declared: false };
    expect(employeeAuditDiff(row, after)).toEqual({
      before: { hireDate: '2026-11-06', declared: true },
      after: { hireDate: '2026-10-27', declared: false },
    });
  });

  it('is empty when nothing changed, equal dates and rest days included', () => {
    const same = {
      ...row,
      hireDate: new Date('2026-11-06T00:00:00.000Z'),
      restDays: [5],
    };
    expect(employeeAuditDiff(row, same)).toEqual({ before: {}, after: {} });
  });

  it('sees a change of rest days and a date cleared', () => {
    const left = { ...row, exitDate: new Date('2026-12-31T00:00:00.000Z') };
    const back = { ...left, exitDate: null, restDays: [5, 6] };
    expect(employeeAuditDiff(left, back)).toEqual({
      before: { exitDate: '2026-12-31', restDays: [5] },
      after: { exitDate: null, restDays: [5, 6] },
    });
  });

  it('never carries the RIB, even when the rows hold it', () => {
    const before = { ...row, bankAccount: '00799999000123456789' };
    const after = { ...row, fullName: 'Karim B.', bankAccount: '00799999000999999999' };
    const diff = JSON.stringify(employeeAuditDiff(before, after));
    expect(diff).not.toContain('bankAccount');
    expect(diff).not.toContain('0079999900');
  });
});
