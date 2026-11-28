import { describe, expect, it } from 'vitest';
import {
  DOC_TYPES,
  DRIVING_ROLES,
  FIELD_SELLER_ROLES,
  OFFICE_ROLES,
  ORDERING_ROLES,
  ROLES,
  SELLING_ROLES,
  TEAM_LEAD_ROLES,
} from './enums';
import { MOBILE_SEAT_ROLES } from './schemas/auth';
import { REPORTS_BY_ROLE } from './schemas/reports';

describe('enums', () => {
  it('lists the roles, the sales force ones last', () => {
    expect(ROLES).toEqual([
      'OWNER',
      'MANAGER',
      'SELLER',
      'STOREKEEPER',
      'SUPERVISOR',
      'LIVREUR',
      'AREA_MANAGER',
      'PREVENDEUR',
    ]);
  });

  it('keeps the closed role lists of phase 40b', () => {
    const office = ['OWNER', 'MANAGER'];
    expect([...SELLING_ROLES]).toEqual([...office, 'SUPERVISOR', 'SELLER', 'AREA_MANAGER']);
    expect([...ORDERING_ROLES]).toEqual([...SELLING_ROLES, 'PREVENDEUR']);
    expect([...DRIVING_ROLES]).toEqual([...SELLING_ROLES, 'LIVREUR']);
    expect([...OFFICE_ROLES]).toEqual([...office, 'SUPERVISOR', 'AREA_MANAGER']);
    expect([...TEAM_LEAD_ROLES]).toEqual(['SUPERVISOR', 'AREA_MANAGER']);
    expect([...FIELD_SELLER_ROLES]).toEqual(['SELLER', 'PREVENDEUR']);
    expect([...MOBILE_SEAT_ROLES].sort()).toEqual([
      'AREA_MANAGER',
      'LIVREUR',
      'PREVENDEUR',
      'SELLER',
      'SUPERVISOR',
    ]);
    expect(REPORTS_BY_ROLE.AREA_MANAGER).toEqual(REPORTS_BY_ROLE.SUPERVISOR);
    expect(REPORTS_BY_ROLE.PREVENDEUR).toEqual(['sales']);
  });

  it('lists the document types that have a numbering sequence', () => {
    expect(DOC_TYPES).toEqual([
      'BL',
      'FAC',
      'AV',
      'BR',
      'VER',
      'INV',
      'RF',
      'RGF',
      'TR',
      'BC',
      'DI',
      'DEP',
      'EMP',
      'PAIE',
      'TRF',
    ]);
  });
});
