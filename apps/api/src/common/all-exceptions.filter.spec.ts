import { isInvalidTextError, isNumericOverflowError } from './all-exceptions.filter';

describe('isInvalidTextError', () => {
  it('recognises SQLSTATE 22021 however Prisma wraps it', () => {
    expect(isInvalidTextError({ code: 'P2010', meta: { code: '22021', message: 'x' } })).toBe(true);
    expect(isInvalidTextError({ code: '22021' })).toBe(true);
    expect(isInvalidTextError(new Error('wrapped', { cause: { code: '22021' } }))).toBe(true);
    expect(
      isInvalidTextError(
        new Error(
          'Raw query failed. Code: `22021`. Message: `invalid byte sequence for encoding "UTF8": 0x00`',
        ),
      ),
    ).toBe(true);
  });

  it('leaves every other error a server error', () => {
    expect(isInvalidTextError(new Error('connection refused'))).toBe(false);
    expect(isInvalidTextError({ code: 'P2002', meta: { target: ['code'] } })).toBe(false);
    expect(isInvalidTextError({ code: 'P2010', meta: { code: '40001' } })).toBe(false);
    expect(isInvalidTextError(null)).toBe(false);
    expect(isInvalidTextError('22021')).toBe(false);
  });
});

describe('isNumericOverflowError', () => {
  it('recognises SQLSTATE 22003 and Prisma P2020 however they are wrapped', () => {
    expect(isNumericOverflowError({ code: '22003' })).toBe(true);
    expect(isNumericOverflowError({ code: 'P2010', meta: { code: '22003' } })).toBe(true);
    expect(isNumericOverflowError({ code: 'P2020' })).toBe(true);
    expect(isNumericOverflowError(new Error('tx', { cause: { code: '22003' } }))).toBe(true);
    expect(
      isNumericOverflowError(
        new Error('Raw query failed. Code: `22003`. Message: `numeric field overflow`'),
      ),
    ).toBe(true);
  });

  it('leaves every other error a server error', () => {
    expect(isNumericOverflowError(new Error('connection refused'))).toBe(false);
    expect(isNumericOverflowError({ code: 'P2002' })).toBe(false);
    expect(isNumericOverflowError({ code: '22021' })).toBe(false);
    expect(isNumericOverflowError(null)).toBe(false);
  });
});

describe('isInvalidTextError, lone surrogate in jsonb', () => {
  it('recognises SQLSTATE 22P05', () => {
    expect(isInvalidTextError({ code: 'P2010', meta: { code: '22P05' } })).toBe(true);
    expect(isInvalidTextError(new Error('unsupported Unicode escape sequence'))).toBe(true);
  });
});
