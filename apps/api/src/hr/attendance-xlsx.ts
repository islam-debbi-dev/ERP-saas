import ExcelJS from 'exceljs';
import { type AttendanceMonthDto, DayStatus } from '@erp/shared';

/** One letter per status, same as the month grid's legend. */
export const STATUS_LETTERS: Record<DayStatus, string> = {
  [DayStatus.PRESENT]: 'P',
  [DayStatus.ABSENT_UNJUSTIFIED]: 'A',
  [DayStatus.ABSENT_JUSTIFIED]: 'J',
  [DayStatus.SICK]: 'M',
  [DayStatus.LEAVE_PAID]: 'C',
  [DayStatus.LEAVE_UNPAID]: 'S',
  [DayStatus.HALF_DAY]: 'D',
  [DayStatus.REST]: 'R',
  [DayStatus.HOLIDAY]: 'F',
  [DayStatus.NOT_EMPLOYED]: '-',
  [DayStatus.UNMARKED]: '?',
};

/** The month grid. Fixed French column titles, like the other exports. */
export async function buildMonthXlsx(month: AttendanceMonthDto): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Pointage');
  sheet.addRow([`Pointage ${month.month}`]).font = { bold: true };
  sheet.addRow([
    'P présent, A absent non justifié, J absent justifié, M maladie, C congé payé, ' +
      'S congé sans solde, D demi-journée, R repos, F fête, ? non pointé',
  ]);
  sheet.addRow([]);
  sheet.addRow([
    'Matricule',
    'Nom',
    ...month.days.map((d) => Number(d.slice(8, 10))),
    'Présents',
    'Absences justifiées',
    'Absences non justifiées',
    'Maladie',
    'Congés payés',
    'Congés sans solde',
    'Non pointés',
    'Retards (min)',
    'Heures sup',
  ]).font = { bold: true };
  for (const r of month.rows) {
    sheet.addRow([
      r.employee.matricule,
      r.employee.fullName,
      ...r.days.map((d) => STATUS_LETTERS[d.status]),
      Number(r.counts.present),
      r.counts.absentJustified,
      r.counts.absentUnjustified,
      r.counts.sick,
      r.counts.leavePaid,
      r.counts.leaveUnpaid,
      r.counts.unmarked,
      r.counts.lateMinutes,
      Number(r.counts.overtimeHours),
    ]);
  }
  sheet.getColumn(1).width = 14;
  sheet.getColumn(2).width = 28;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
