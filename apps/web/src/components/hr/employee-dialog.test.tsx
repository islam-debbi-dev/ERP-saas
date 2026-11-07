import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmployeeDto } from '@erp/shared';
import messages from '@/messages/fr.json';
import { EmployeeDialog } from './employee-dialog';

const mutate = vi.hoisted(() => vi.fn());
const perms = vi.hoisted(() => ({ salary: true }));

vi.mock('@/lib/auth', () => ({
  usePermission: (p: string) => (p === 'SALARY_VIEW' ? perms.salary : false),
  useFeature: () => false,
}));
vi.mock('@/lib/hr', () => ({ useSaveEmployee: () => ({ mutate, isPending: false }) }));
vi.mock('@/lib/stock', () => ({ useWarehouses: () => ({ data: [] }) }));
vi.mock('@/lib/users', () => ({ useUsers: () => ({ data: [] }) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));

const employee = {
  id: 'e1',
  fullName: 'Mohamed',
  phone: null,
  position: null,
  warehouse: null,
  user: null,
  hireDate: '2026-10-27',
  exitDate: null,
  contract: 'CDI',
  contractEndDate: null,
  declared: false,
  nss: null,
  nin: null,
  birthDate: null,
  restDays: null,
  firstSalaryFrom: '2026-11-06',
  pay: {
    bankAccount: null,
    payType: 'MONTHLY',
    salary: '40000.00',
    advanceBalance: '0.00',
    firstSalary: { amount: '40000.00', payType: 'MONTHLY' },
  },
} as unknown as EmployeeDto;

function renderDialog() {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <EmployeeDialog open employee={employee} onOpenChange={() => undefined} />
    </NextIntlClientProvider>,
  );
}

const field = (label: string) => screen.getByLabelText(label);
const box = () => screen.getByRole<HTMLInputElement>('checkbox');
const save = () => fireEvent.click(screen.getByRole('button', { name: messages.hr.save }));
const sent = () => (mutate.mock.calls[0]![0] as { body: Record<string, unknown> }).body;

afterEach(() => {
  cleanup();
  mutate.mockReset();
  perms.salary = true;
});

describe('EmployeeDialog, a salary that starts after the hire date', () => {
  it('adds no salary when only the phone changes: notice shown, box not ticked', () => {
    renderDialog();
    expect(box().checked).toBe(false);
    fireEvent.change(field(messages.hr.phone), { target: { value: '0550000000' } });
    save();
    expect(sent().phone).toBe('0550000000');
    expect(sent()).not.toHaveProperty('alignFirstSalary');
  });

  it('ticks the box when the hire date changes in the dialog', () => {
    renderDialog();
    fireEvent.change(field(messages.hr.hireDate), { target: { value: '2026-10-20' } });
    expect(box().checked).toBe(true);
    save();
    expect(sent()).toMatchObject({ hireDate: '2026-10-20', alignFirstSalary: true });
  });

  it('keeps the choice of a user who unticks it', () => {
    renderDialog();
    fireEvent.change(field(messages.hr.hireDate), { target: { value: '2026-10-20' } });
    fireEvent.click(box());
    save();
    expect(sent()).not.toHaveProperty('alignFirstSalary');
  });

  it('lets the owner tick it by hand on an old file', () => {
    renderDialog();
    fireEvent.click(box());
    save();
    expect(sent()).toMatchObject({ alignFirstSalary: true });
  });

  it('never sends the flag without SALARY_VIEW', () => {
    perms.salary = false;
    renderDialog();
    fireEvent.change(field(messages.hr.hireDate), { target: { value: '2026-10-20' } });
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText(messages.hr.salaryStartsLaterOwner)).toBeTruthy();
    save();
    expect(sent()).not.toHaveProperty('alignFirstSalary');
  });
});
