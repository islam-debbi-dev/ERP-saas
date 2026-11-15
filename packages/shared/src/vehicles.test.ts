import { describe, expect, it } from 'vitest';
import { proposeVehicleCode, VEHICLE_CODE_MAX } from './vehicles';

describe('proposeVehicleCode', () => {
  it('builds prefix-wilaya, the type code and the first number', () => {
    expect(proposeVehicleCode({ prefix: 'VAN', typeCode: 'MXT', wilayaCode: 28, taken: [] })).toBe(
      'VAN-28 MXT 01',
    );
  });

  it('takes the next free number, whatever the case of the codes in use', () => {
    const taken = ['VAN-28 MXT 01', 'van-28 mxt 02', 'VAN-28 MXT 04'];
    expect(proposeVehicleCode({ prefix: 'VAN', typeCode: 'MXT', wilayaCode: 28, taken })).toBe(
      'VAN-28 MXT 03',
    );
  });

  it('works without a prefix, without a wilaya, without a type', () => {
    expect(proposeVehicleCode({ typeCode: 'MIX', wilayaCode: 5, taken: [] })).toBe('05 MIX 01');
    expect(proposeVehicleCode({ prefix: 'LIV', typeCode: 'MIX', taken: [] })).toBe('LIV MIX 01');
    expect(proposeVehicleCode({ prefix: null, typeCode: null, taken: ['01'] })).toBe('02');
  });

  it("keeps the owner's text as typed", () => {
    expect(
      proposeVehicleCode({ prefix: 'Prv', typeCode: 'Self/mt', wilayaCode: 34, taken: [] }),
    ).toBe('Prv-34 Self/mt 01');
  });

  it('never proposes a code longer than the column', () => {
    const code = proposeVehicleCode({
      prefix: 'ABCDEFGHIJ',
      typeCode: 'ABCDEFGHIJKLMNOPQRST',
      wilayaCode: 28,
      taken: [],
    });
    expect(code.length).toBeLessThanOrEqual(VEHICLE_CODE_MAX);
    expect(code.endsWith(' 01')).toBe(true);
  });
});
