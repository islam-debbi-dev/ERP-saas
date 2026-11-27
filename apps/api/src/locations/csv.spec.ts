import { csvCell, csvLine } from './csv';

describe('csvCell', () => {
  it.each(['=1+1', '+213', '-2', '@SUM(A1)', '  =cmd', '\t1', '\r1', '＝1'])(
    'does not let %j run as a formula',
    (text) => {
      expect(csvCell(text)).toBe(`"'${text}"`);
    },
  );

  it('quotes every cell and doubles the quotes', () => {
    expect(csvLine(['Cité "A"; bloc 2', null, 16, "M'Sila"])).toBe(
      `"Cité ""A""; bloc 2";"";"16";"M'Sila"\r\n`,
    );
  });
});
