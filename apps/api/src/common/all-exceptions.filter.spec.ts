import { isInvalidTextError } from './all-exceptions.filter';

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
