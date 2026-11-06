import { describe, expect, it } from 'vitest';
import { DOC_TYPES, ROLES } from './enums';

describe('enums', () => {
  it('lists the roles, the sales force ones last', () => {
    expect(ROLES).toEqual(['OWNER', 'MANAGER', 'SELLER', 'STOREKEEPER', 'SUPERVISOR', 'LIVREUR']);
  });

  it('lists the document types that have a numbering sequence', () => {
    expect(DOC_TYPES).toEqual(['BL', 'FAC', 'AV', 'BR', 'VER', 'INV', 'RF', 'RGF', 'TR', 'BC', 'DI', 'DEP', 'EMP', 'PAIE', 'TRF']);
  });
});
