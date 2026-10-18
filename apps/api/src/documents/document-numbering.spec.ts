import { documentYear, formatDocumentNumber } from './document-numbering.service';

describe('document numbering helpers', () => {
  it('pads to 6 digits', () => {
    expect(formatDocumentNumber('BL', 2026, 1)).toBe('BL-2026-000001');
    expect(formatDocumentNumber('FAC', 2026, 123456)).toBe('FAC-2026-123456');
  });

  it('uses the Algiers year (UTC+1) at new year', () => {
    expect(documentYear(new Date('2026-12-31T22:59:59Z'))).toBe(2026);
    expect(documentYear(new Date('2026-12-31T23:00:00Z'))).toBe(2027);
  });
});
