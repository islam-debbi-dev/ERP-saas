/** Static demo data: French / Algerian names, the 30 products, the team layout. */
export type Role = 'SUPERVISOR' | 'SELLER' | 'LIVREUR' | 'STOREKEEPER';

export interface UserSpec {
  key: string;
  fullName: string;
  email: string;
  role: Role;
  /** Key of the supervisor (team), null for a supervisor or the storekeeper. */
  manager: string | null;
  team: 'A' | 'B' | '-';
  /** Code of the truck he drives today. */
  truck: string | null;
}

export const USERS: UserSpec[] = [
  { key: 'supA', fullName: 'Karim Benzaoui', email: 'karim.benzaoui@demo-volume.dz', role: 'SUPERVISOR', manager: null, team: 'A', truck: null },
  { key: 'supB', fullName: 'Samir Haddad', email: 'samir.haddad@demo-volume.dz', role: 'SUPERVISOR', manager: null, team: 'B', truck: null },
  { key: 'sel1', fullName: 'Yacine Boudjemaa', email: 'yacine.boudjemaa@demo-volume.dz', role: 'SELLER', manager: 'supA', team: 'A', truck: 'VAN-1' },
  { key: 'sel2', fullName: 'Nabil Cherif', email: 'nabil.cherif@demo-volume.dz', role: 'SELLER', manager: 'supA', team: 'A', truck: 'VAN-2' },
  { key: 'sel3', fullName: 'Redouane Mekki', email: 'redouane.mekki@demo-volume.dz', role: 'SELLER', manager: 'supB', team: 'B', truck: 'VAN-3' },
  { key: 'sel4', fullName: 'Hichem Ghezali', email: 'hichem.ghezali@demo-volume.dz', role: 'SELLER', manager: 'supB', team: 'B', truck: 'VAN-4' },
  { key: 'liv1', fullName: 'Farid Zeroual', email: 'farid.zeroual@demo-volume.dz', role: 'LIVREUR', manager: 'supA', team: 'A', truck: 'LIV-1' },
  { key: 'liv2', fullName: 'Amine Slimani', email: 'amine.slimani@demo-volume.dz', role: 'LIVREUR', manager: 'supB', team: 'B', truck: 'LIV-2' },
  { key: 'mag', fullName: 'Lamine Brahimi', email: 'lamine.brahimi@demo-volume.dz', role: 'STOREKEEPER', manager: null, team: '-', truck: null },
];

export const SELLER_KEYS = ['sel1', 'sel2', 'sel3', 'sel4'] as const;

export interface TruckSpec {
  code: string;
  type: 'VAN' | 'LIV';
  name: string;
  plate: string;
  driver: string;
}

export const TRUCKS: TruckSpec[] = [
  { code: 'VAN-1', type: 'VAN', name: 'Camionnette Yacine', plate: '10211-118-28', driver: 'sel1' },
  { code: 'VAN-2', type: 'VAN', name: 'Camionnette Nabil', plate: '10344-119-28', driver: 'sel2' },
  { code: 'VAN-3', type: 'VAN', name: 'Camionnette Redouane', plate: '10577-120-28', driver: 'sel3' },
  { code: 'VAN-4', type: 'VAN', name: 'Camionnette Hichem', plate: '10690-121-28', driver: 'sel4' },
  { code: 'LIV-1', type: 'LIV', name: 'Camion livraison Farid', plate: '20112-117-28', driver: 'liv1' },
  { code: 'LIV-2', type: 'LIV', name: 'Camion livraison Amine', plate: '20458-116-28', driver: 'liv2' },
];

/** Each vendeur's clients: [town key, how many]. 150 clients in all. */
export const SELLER_TOWNS: Record<(typeof SELLER_KEYS)[number], [string, number][]> = {
  sel1: [['msila', 40]],
  sel2: [['bousaada', 38]],
  sel3: [
    ['sidiaissa', 25],
    ['ainelmelh', 12],
  ],
  sel4: [
    ['magra', 20],
    ['berhoum', 15],
  ],
};

export const CLIENT_PREFIXES = [
  'Supérette',
  'Épicerie',
  'Alimentation Générale',
  'Commerce',
  'Superette',
  'Mini-marché',
  'Magasin',
  'Cafétéria',
  'Boulangerie',
  'Pâtisserie',
];
export const FAMILY_NAMES = [
  'Benali', 'Merzouk', 'Hamidi', 'Bouzid', 'Khelifi', 'Saadi', 'Belkacem', 'Rahmani', 'Boukhalfa', 'Mebarki',
  'Laribi', 'Djaballah', 'Ferhat', 'Amrani', 'Tebbal', 'Zerrouki', 'Bensalem', 'Hadjadj', 'Maamri', 'Bouchama',
  'Kaci', 'Ouali', 'Belaid', 'Chaabane', 'Guerfi', 'Messaoudi', 'Taleb', 'Hamlaoui', 'Daoudi', 'Berkani',
];

export interface ProductSpec {
  ref: string;
  name: string;
  perCarton: number;
  /** Price of one carton, HT, in DA. */
  cartonHt: number;
  tva: '0' | '9' | '19';
}

export const PRODUCTS: ProductSpec[] = [
  ['Huile de table 5 L', 4, 4600, '19'],
  ['Huile de table 1 L', 12, 2300, '19'],
  ['Sucre blanc 1 kg', 10, 1450, '0'],
  ['Farine de blé 1 kg', 12, 1100, '0'],
  ['Semoule moyenne 1 kg', 12, 1250, '0'],
  ['Semoule fine 5 kg', 4, 1900, '0'],
  ['Pâtes spaghetti 500 g', 20, 1700, '9'],
  ['Pâtes coudées 500 g', 20, 1700, '9'],
  ['Couscous moyen 1 kg', 12, 1900, '9'],
  ['Riz long grain 1 kg', 12, 2300, '9'],
  ['Lentilles 1 kg', 12, 2600, '9'],
  ['Pois chiches 1 kg', 12, 2400, '9'],
  ['Haricots blancs 1 kg', 12, 2500, '9'],
  ['Concentré de tomate 400 g', 24, 3300, '19'],
  ['Harissa 380 g', 24, 2900, '19'],
  ['Thon à l\'huile 160 g', 48, 6600, '19'],
  ['Sardines en boîte 125 g', 50, 4900, '19'],
  ['Lait UHT 1 L', 12, 1700, '9'],
  ['Lait en poudre 400 g', 24, 9200, '19'],
  ['Fromage fondu portions', 24, 3200, '19'],
  ['Café moulu 250 g', 20, 5600, '19'],
  ['Thé vert 200 g', 25, 4200, '19'],
  ['Eau minérale 1,5 L (pack 6)', 6, 540, '19'],
  ['Jus d\'orange 1 L', 12, 1900, '19'],
  ['Boisson gazeuse 2 L (pack 6)', 6, 1050, '19'],
  ['Biscuits fourrés', 24, 2700, '19'],
  ['Chocolat à tartiner 400 g', 12, 4100, '19'],
  ['Confiture d\'abricot 370 g', 12, 2600, '19'],
  ['Savon de ménage (lot 6)', 12, 1500, '19'],
  ['Lessive en poudre 3 kg', 4, 3400, '19'],
].map(([name, perCarton, cartonHt, tva], i) => ({
  ref: `FLD-P${String(i + 1).padStart(2, '0')}`,
  name: name as string,
  perCarton: perCarton as number,
  cartonHt: cartonHt as number,
  tva: tva as '0' | '9' | '19',
}));

export const NO_SALE_REASONS = ['CLOSED', 'HAS_STOCK', 'NO_MONEY', 'REFUSED'] as const;
export const HANDED_CASH = ['1200.00', '2500.00', '800.00', '4100.00'];
