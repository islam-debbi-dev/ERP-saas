import { describe, expect, it } from 'vitest';
import { DOC_TYPES, ROLES } from './enums';

describe('enums', () => {
  it('lists the four roles', () => {
    expect(ROLES).toEqual(['OWNER', 'MANAGER', 'SELLER', 'STOREKEEPER']);
  });

  it('lists the document types that have a numbering sequence', () => {
    expect(DOC_TYPES).toEqual(['BL', 'FAC', 'AV', 'BR', 'VER']);
  });
});
