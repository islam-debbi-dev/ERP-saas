import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PayrollRunDetailDto, PayslipDto, PayslipIssue } from '@erp/shared';
import messages from '@/messages/fr.json';
import { Notices } from './payroll-run-page';

vi.mock('@/lib/auth', () => ({ usePermission: () => true, useFeature: () => true }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const slip = (id: string, fullName: string, issues: PayslipIssue[]) =>
  ({ id, employeeId: `emp-${id}`, fullName, issues }) as unknown as PayslipDto;

function renderNotices(payslips: PayslipDto[]) {
  const run = {
    status: 'DRAFT',
    payslips,
    ratesConfirmed: true,
    rateSetToVerify: false,
    manualSalaryExpenses: '0.00',
    incentivesWithoutEmployee: [],
  } as unknown as PayrollRunDetailDto;
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <Notices run={run} />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe('payroll run notices', () => {
  it('says when the salary starts, under a link to the employee', () => {
    renderNotices([
      slip('a', 'Karim', [{ code: 'NO_SALARY', details: { salaryFrom: '2026-11-06' } }]),
    ]);
    expect(screen.getByRole('link', { name: 'Karim' }).getAttribute('href')).toBe(
      '/rh/employes/emp-a',
    );
    expect(screen.getByText(/Salaire seulement à partir du/).textContent).toBe(
      'Salaire seulement à partir du 06/11/2026',
    );
  });

  it('names no date for an employee with no salary at all', () => {
    renderNotices([slip('b', 'Samir', [{ code: 'NO_SALARY' }])]);
    expect(screen.getByRole('link', { name: 'Samir' })).toBeTruthy();
    expect(screen.queryByText(/Salaire seulement/)).toBeNull();
  });
});
