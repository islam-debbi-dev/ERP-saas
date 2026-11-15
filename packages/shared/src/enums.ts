/** Enums shared by the API (mirrored in the Prisma schema) and the web app. */

export const Role = {
  OWNER: 'OWNER',
  MANAGER: 'MANAGER',
  SELLER: 'SELLER',
  STOREKEEPER: 'STOREKEEPER',
  /** Manages a team of sellers through `User.managerId` (phase 14). */
  SUPERVISOR: 'SUPERVISOR',
  /** Delivers pre-sale orders (screens in phase 16). */
  LIVREUR: 'LIVREUR',
} as const;
export type Role = (typeof Role)[keyof typeof Role];
export const ROLES = Object.values(Role);

/**
 * Which clients a seller sees (phase 14, SALES_FORCE). ALL_CLIENTS keeps the old
 * behaviour; ASSIGNED_ONLY limits a seller to his assigned clients and his own documents.
 */
export const SellerScope = {
  ALL_CLIENTS: 'ALL_CLIENTS',
  ASSIGNED_ONLY: 'ASSIGNED_ONLY',
} as const;
export type SellerScope = (typeof SellerScope)[keyof typeof SellerScope];
export const SELLER_SCOPES = Object.values(SellerScope);

/**
 * Which clients a livreur sees when SALES_FORCE is on: every client of the company, or
 * only the clients of the commandes assigned to him. Set by the owner in the settings.
 */
export const LivreurScope = {
  ALL_CLIENTS: 'ALL_CLIENTS',
  OWN_DELIVERIES: 'OWN_DELIVERIES',
} as const;
export type LivreurScope = (typeof LivreurScope)[keyof typeof LivreurScope];
export const LIVREUR_SCOPES = Object.values(LivreurScope);

/** Roles that can be put on a sale as its seller, or on a versement as its collector. */
export const SELLING_ROLES: readonly Role[] = [
  Role.OWNER,
  Role.MANAGER,
  Role.SUPERVISOR,
  Role.SELLER,
];

/**
 * Roles that can be the driver of a truck (phase 36): whoever sells, and the livreur, who
 * drives a delivery truck.
 */
export const DRIVING_ROLES: readonly Role[] = [...SELLING_ROLES, Role.LIVREUR];

/** Office roles pick the seller of a sale; a SELLER always sells in his own name. */
export const OFFICE_ROLES: readonly Role[] = [Role.OWNER, Role.MANAGER, Role.SUPERVISOR];

/** Document types with their own numbering sequence. See docs/domain.md glossary. */
export const DocType = {
  BL: 'BL',
  FAC: 'FAC',
  AV: 'AV',
  BR: 'BR',
  VER: 'VER',
  /** Inventaire (physical stock count). */
  INV: 'INV',
  /** Retour fournisseur (partial return of a bon de réception). */
  RF: 'RF',
  /** Règlement fournisseur (payment to a supplier). */
  RGF: 'RGF',
  /** Transfert de stock: bon de chargement / déchargement (phase 15). */
  TR: 'TR',
  /** Bon de commande: a pre-sale order, no stock or ledger effect (phase 16). */
  BC: 'BC',
  /** Dossier d'importation: one shipment, its BRs and costs (phase 22). */
  DI: 'DI',
  /** Dépense: a charge paid by the company (rent, electricity, salaries...; phase 25). */
  DEP: 'DEP',
  /** Matricule of an employee (phase 31): per tenant, not per year (`EMP-000001`). */
  EMP: 'EMP',
  /** Paie: one approved payroll run (phase 31b). */
  PAIE: 'PAIE',
  /** Transfert de trésorerie: from one account to another (phase 34). */
  TRF: 'TRF',
} as const;
export type DocType = (typeof DocType)[keyof typeof DocType];
export const DOC_TYPES = Object.values(DocType);

export const CreditLimitMode = {
  WARN: 'WARN',
  BLOCK: 'BLOCK',
} as const;
export type CreditLimitMode = (typeof CreditLimitMode)[keyof typeof CreditLimitMode];

export const NegativeStockMode = {
  ALLOW: 'ALLOW',
  WARN: 'WARN',
  BLOCK: 'BLOCK',
} as const;
export type NegativeStockMode = (typeof NegativeStockMode)[keyof typeof NegativeStockMode];

/**
 * Units every tenant starts with. Codes are stable identifiers translated in the
 * UI (`units.PIECE` …); tenants can add custom units with a free-text name.
 */
export const DEFAULT_UNITS = [
  { code: 'PIECE', allowsDecimal: false },
  { code: 'KG', allowsDecimal: true },
  { code: 'LITRE', allowsDecimal: true },
  { code: 'METRE', allowsDecimal: true },
  { code: 'CARTON', allowsDecimal: false },
  { code: 'FARDEAU', allowsDecimal: false },
  { code: 'SAC', allowsDecimal: false },
  { code: 'BOITE', allowsDecimal: false },
  { code: 'PAQUET', allowsDecimal: false },
] as const;
export type DefaultUnitCode = (typeof DEFAULT_UNITS)[number]['code'];

/** Names given to price levels 1..5 when a tenant is created; editable afterwards. */
export const DEFAULT_PRICE_LEVEL_NAMES = [
  'Gros',
  'Demi-gros',
  'Détail',
  'Niveau 4',
  'Niveau 5',
] as const;
export const MAX_PRICE_LEVELS = 5;

/**
 * TVA rates offered in the product form. Only a UI shortcut: the rate is stored
 * on each product and the API accepts any value between 0 and 100.
 */
export const COMMON_TVA_RATES = ['0', '9', '19'] as const;

export const StockMovementType = {
  OPENING: 'OPENING',
  PURCHASE: 'PURCHASE',
  PURCHASE_RETURN: 'PURCHASE_RETURN',
  SALE: 'SALE',
  SALE_RETURN: 'SALE_RETURN',
  ADJUSTMENT: 'ADJUSTMENT',
  INVENTORY: 'INVENTORY',
  /** Phase 15: the two halves of a transfer between warehouses, at the current CUMP. */
  TRANSFER_OUT: 'TRANSFER_OUT',
  TRANSFER_IN: 'TRANSFER_IN',
  /** Phase 22: a late import cost; changes the stock value (valueDelta), never the quantity. */
  COST_ADJUST: 'COST_ADJUST',
} as const;
export type StockMovementType = (typeof StockMovementType)[keyof typeof StockMovementType];

export const AdjustmentReason = {
  CASSE: 'CASSE',
  PERTE: 'PERTE',
  ERREUR: 'ERREUR',
  AUTRE: 'AUTRE',
} as const;
export type AdjustmentReason = (typeof AdjustmentReason)[keyof typeof AdjustmentReason];
export const ADJUSTMENT_REASONS = Object.values(AdjustmentReason);

export const InventoryStatus = {
  OPEN: 'OPEN',
  VALIDATED: 'VALIDATED',
  CANCELLED: 'CANCELLED',
} as const;
export type InventoryStatus = (typeof InventoryStatus)[keyof typeof InventoryStatus];

/** Dépôts (phase 15, WAREHOUSES). Without the module a tenant has one implicit MAIN. */
export const WarehouseType = {
  MAIN: 'MAIN',
  SECONDARY: 'SECONDARY',
  /** A truck: a seller's stock on the road. */
  VEHICLE: 'VEHICLE',
} as const;
export type WarehouseType = (typeof WarehouseType)[keyof typeof WarehouseType];
export const WAREHOUSE_TYPES = Object.values(WarehouseType);

/**
 * What a truck does on the road (phase 36). The company names its own vehicle types; each
 * one points to one of these because screens and statistics differ. A hint, never a block.
 */
export const VehicleActivity = {
  /** Vente directe: loads stock, sells and collects on the road. */
  CASH_VAN: 'CASH_VAN',
  /** Prévente: takes bons de commande, carries no stock to sell. */
  PRESALE: 'PRESALE',
  /** Livraison: delivers confirmed orders. */
  DELIVERY: 'DELIVERY',
  /** Several of the above. */
  MIXED: 'MIXED',
} as const;
export type VehicleActivity = (typeof VehicleActivity)[keyof typeof VehicleActivity];
export const VEHICLE_ACTIVITIES = Object.values(VehicleActivity);
/** The activities of a truck that delivers orders. */
export const DELIVERY_ACTIVITIES: readonly VehicleActivity[] = [
  VehicleActivity.DELIVERY,
  VehicleActivity.MIXED,
];

/**
 * A user's reach in one dépôt (phase 24, MULTI_UNIT). OPERATE: he works there (sells,
 * receives, sees its documents). VIEW_STATS: he sees its aggregated figures only.
 */
export const WarehouseAccessLevel = {
  OPERATE: 'OPERATE',
  VIEW_STATS: 'VIEW_STATS',
} as const;
export type WarehouseAccessLevel = (typeof WarehouseAccessLevel)[keyof typeof WarehouseAccessLevel];
export const WAREHOUSE_ACCESS_LEVELS = Object.values(WarehouseAccessLevel);

export const StockTransferType = {
  /** Chargement: dépôt → camion. */
  LOAD: 'LOAD',
  /** Déchargement: camion → dépôt. */
  UNLOAD: 'UNLOAD',
  /** Any other move between two dépôts. */
  TRANSFER: 'TRANSFER',
} as const;
export type StockTransferType = (typeof StockTransferType)[keyof typeof StockTransferType];
export const STOCK_TRANSFER_TYPES = Object.values(StockTransferType);

export const StockTransferStatus = {
  DRAFT: 'DRAFT',
  VALIDATED: 'VALIDATED',
  CANCELLED: 'CANCELLED',
} as const;
export type StockTransferStatus = (typeof StockTransferStatus)[keyof typeof StockTransferStatus];

export const PurchaseStatus = {
  DRAFT: 'DRAFT',
  /** Validated inside an open dossier d'importation: on the supplier account, not in stock yet. */
  IN_TRANSIT: 'IN_TRANSIT',
  VALIDATED: 'VALIDATED',
  CANCELLED: 'CANCELLED',
} as const;
export type PurchaseStatus = (typeof PurchaseStatus)[keyof typeof PurchaseStatus];

export const ClientType = {
  PARTICULIER: 'PARTICULIER',
  PROFESSIONNEL: 'PROFESSIONNEL',
} as const;
export type ClientType = (typeof ClientType)[keyof typeof ClientType];

/** Client account entries. Positive amounts mean the client owes more. */
export const ClientLedgerType = {
  OPENING: 'OPENING',
  SALE: 'SALE',
  PAYMENT: 'PAYMENT',
  RETURN: 'RETURN',
  ADJUSTMENT: 'ADJUSTMENT',
  REVERSAL: 'REVERSAL',
} as const;
export type ClientLedgerType = (typeof ClientLedgerType)[keyof typeof ClientLedgerType];

/** Supplier account entries (phase 21). Positive amounts mean we owe the supplier more. */
export const SupplierLedgerType = {
  OPENING: 'OPENING',
  PURCHASE: 'PURCHASE',
  PAYMENT: 'PAYMENT',
  RETURN: 'RETURN',
  ADJUST: 'ADJUST',
  REVERSAL: 'REVERSAL',
  /** A cost line of a dossier d'importation owed to this supplier (phase 22). */
  IMPORT_COST: 'IMPORT_COST',
} as const;
export type SupplierLedgerType = (typeof SupplierLedgerType)[keyof typeof SupplierLedgerType];

export const SupplierPaymentStatus = {
  VALID: 'VALID',
  CANCELLED: 'CANCELLED',
} as const;
export type SupplierPaymentStatus =
  (typeof SupplierPaymentStatus)[keyof typeof SupplierPaymentStatus];

/** Documents a share link can open (phase 21). */
export const ShareDocType = {
  /** Relevé de compte of a client. */
  RELEVE: 'RELEVE',
  FACTURE: 'FACTURE',
} as const;
export type ShareDocType = (typeof ShareDocType)[keyof typeof ShareDocType];

export const SaleType = {
  /** Bon de livraison: the everyday sale document. */
  BL: 'BL',
  FACTURE: 'FACTURE',
} as const;
export type SaleType = (typeof SaleType)[keyof typeof SaleType];

export const SaleStatus = {
  DRAFT: 'DRAFT',
  VALIDATED: 'VALIDATED',
  CANCELLED: 'CANCELLED',
} as const;
export type SaleStatus = (typeof SaleStatus)[keyof typeof SaleStatus];

export const PaymentMode = {
  ESPECES: 'ESPECES',
  CHEQUE: 'CHEQUE',
  VIREMENT: 'VIREMENT',
} as const;
export type PaymentMode = (typeof PaymentMode)[keyof typeof PaymentMode];
export const PAYMENT_MODES = Object.values(PaymentMode);

/** A dépense is immutable: a mistake is cancelled and entered again (phase 25). */
export const ExpenseStatus = {
  VALID: 'VALID',
  CANCELLED: 'CANCELLED',
} as const;
export type ExpenseStatus = (typeof ExpenseStatus)[keyof typeof ExpenseStatus];

/**
 * The categories every company starts with (phase 25). The key identifies them whatever
 * the owner renames them to; `RENT` (Loyer) is the one rent payments use.
 */
export const ExpenseCategoryKey = {
  RENT: 'RENT',
  UTILITIES: 'UTILITIES',
  SALARIES: 'SALARIES',
  TRANSPORT: 'TRANSPORT',
  TELECOM: 'TELECOM',
  OTHER: 'OTHER',
} as const;
export type ExpenseCategoryKey = (typeof ExpenseCategoryKey)[keyof typeof ExpenseCategoryKey];

/** Default names of the seeded categories (French, as the owner types them). */
export const DEFAULT_EXPENSE_CATEGORIES: readonly { key: ExpenseCategoryKey; name: string }[] = [
  { key: ExpenseCategoryKey.RENT, name: 'Loyer' },
  { key: ExpenseCategoryKey.UTILITIES, name: 'Électricité / eau' },
  { key: ExpenseCategoryKey.SALARIES, name: 'Salaires' },
  { key: ExpenseCategoryKey.TRANSPORT, name: 'Transport / carburant' },
  { key: ExpenseCategoryKey.TELECOM, name: 'Téléphone / internet' },
  { key: ExpenseCategoryKey.OTHER, name: 'Autre' },
];

/** How often a rent contract (bail) is due. */
export const RentPeriod = {
  MONTHLY: 'MONTHLY',
  QUARTERLY: 'QUARTERLY',
  YEARLY: 'YEARLY',
} as const;
export type RentPeriod = (typeof RentPeriod)[keyof typeof RentPeriod];
export const RENT_PERIODS = Object.values(RentPeriod);

export const PaymentStatus = {
  VALID: 'VALID',
  CANCELLED: 'CANCELLED',
  BOUNCED: 'BOUNCED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

/** What happens to goods a client brings back. */
export const ReturnDisposition = {
  /** Back on the shelf. */
  RESTOCK: 'RESTOCK',
  /** Taken back but unsellable: returned then written off (ADJUSTMENT, CASSE). */
  DAMAGED: 'DAMAGED',
} as const;
export type ReturnDisposition = (typeof ReturnDisposition)[keyof typeof ReturnDisposition];

/** Paper size of printed documents (thermal 80 mm comes with the caisse). */
export const PrintFormat = {
  A4: 'A4',
  A5: 'A5',
} as const;
export type PrintFormat = (typeof PrintFormat)[keyof typeof PrintFormat];

/** Documents printed through `GET /documents/:type/:id/pdf`. */
export const PrintableDocType = {
  BL: 'BL',
  FAC: 'FAC',
  AV: 'AV',
  BR: 'BR',
  /** Bon de chargement / déchargement / transfert (phase 15). */
  TR: 'TR',
  /** Bon de commande (phase 16). */
  BC: 'BC',
  /** Fiche de coût de revient of a dossier d'importation (phase 22). */
  DI: 'DI',
} as const;
export type PrintableDocType = (typeof PrintableDocType)[keyof typeof PrintableDocType];

// ---------------------------------------------------------------- tournées (phase 16, TOURNEES)

/** What came out of a stop. */
export const VisitOutcome = {
  SALE: 'SALE',
  ORDER: 'ORDER',
  PAYMENT_ONLY: 'PAYMENT_ONLY',
  NO_SALE: 'NO_SALE',
} as const;
export type VisitOutcome = (typeof VisitOutcome)[keyof typeof VisitOutcome];
export const VISIT_OUTCOMES = Object.values(VisitOutcome);

/** Why a visit ended without a sale (NO_SALE only). */
export const NoSaleReason = {
  CLOSED: 'CLOSED',
  HAS_STOCK: 'HAS_STOCK',
  NO_MONEY: 'NO_MONEY',
  REFUSED: 'REFUSED',
  OTHER: 'OTHER',
} as const;
export type NoSaleReason = (typeof NoSaleReason)[keyof typeof NoSaleReason];
export const NO_SALE_REASONS = Object.values(NoSaleReason);

/** Bon de commande. Only DELIVERED has effects, through the BL it created. */
export const OrderStatus = {
  DRAFT: 'DRAFT',
  CONFIRMED: 'CONFIRMED',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];
export const ORDER_STATUSES = Object.values(OrderStatus);

/** Clôture de tournée. A CLOSED session is final; corrections are ADJUST rows. */
export const SellerSessionStatus = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
  /** A note on a closed session, written as a new row (`adjustsSessionId`). */
  ADJUST: 'ADJUST',
} as const;
export type SellerSessionStatus = (typeof SellerSessionStatus)[keyof typeof SellerSessionStatus];

/** How the tenant treats an operation far from the client (phase 17, GEO_CHECK). */
export const GeoCheckMode = {
  OFF: 'OFF',
  /** Default: saved, flagged, needs a note and a manager review. */
  FLAG: 'FLAG',
  /** FAR and MOCKED are refused unless the user has GEO_OVERRIDE. */
  BLOCK: 'BLOCK',
} as const;
export type GeoCheckMode = (typeof GeoCheckMode)[keyof typeof GeoCheckMode];
export const GEO_CHECK_MODES = Object.values(GeoCheckMode);

/** Result of comparing the device position with the client's point, first match wins. */
export const GeoStatus = {
  NO_SIGNAL: 'NO_SIGNAL',
  MOCKED: 'MOCKED',
  LOW_ACCURACY: 'LOW_ACCURACY',
  NO_CLIENT_GPS: 'NO_CLIENT_GPS',
  OK: 'OK',
  FAR: 'FAR',
} as const;
export type GeoStatus = (typeof GeoStatus)[keyof typeof GeoStatus];
export const GEO_STATUSES = Object.values(GeoStatus);

/** Extra marks on a GeoCheck, independent of its status. */
export const GeoFlag = {
  /** Captured more than 2 h before the server got it (offline replay). */
  LATE_SYNC: 'LATE_SYNC',
} as const;
export type GeoFlag = (typeof GeoFlag)[keyof typeof GeoFlag];

/** The document a GeoCheck belongs to. */
export const GeoRefType = {
  SALE: 'SALE',
  PAYMENT: 'PAYMENT',
  VISIT: 'VISIT',
  /** A self check-in or check-out (phase 31): measured from the dépôt, not a client. */
  ATTENDANCE: 'ATTENDANCE',
} as const;
export type GeoRefType = (typeof GeoRefType)[keyof typeof GeoRefType];
export const GEO_REF_TYPES = Object.values(GeoRefType);

/** A manager's verdict on a flagged operation. */
export const GeoReviewStatus = {
  NONE: 'NONE',
  JUSTIFIED: 'JUSTIFIED',
  NOT_JUSTIFIED: 'NOT_JUSTIFIED',
} as const;
export type GeoReviewStatus = (typeof GeoReviewStatus)[keyof typeof GeoReviewStatus];
export const GEO_REVIEW_STATUSES = Object.values(GeoReviewStatus);

/** A seller's request to move a client's saved point. */
export const GeoChangeRequestStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type GeoChangeRequestStatus =
  (typeof GeoChangeRequestStatus)[keyof typeof GeoChangeRequestStatus];
export const GEO_CHANGE_REQUEST_STATUSES = Object.values(GeoChangeRequestStatus);

// ---------------------------------------------------------------- objectifs & primes (phase 18)

export const IncentivePeriod = {
  MONTH: 'MONTH',
  QUARTER: 'QUARTER',
} as const;
export type IncentivePeriod = (typeof IncentivePeriod)[keyof typeof IncentivePeriod];
export const INCENTIVE_PERIODS = Object.values(IncentivePeriod);

/** A DRAFT is edited; an ACTIVE plan never is (a change is a new version). */
export const IncentivePlanStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
} as const;
export type IncentivePlanStatus = (typeof IncentivePlanStatus)[keyof typeof IncentivePlanStatus];
export const INCENTIVE_PLAN_STATUSES = Object.values(IncentivePlanStatus);

/** Who a rule applies to: every user of a role, one user, or a manager on his team. */
export const IncentiveAppliesTo = {
  ROLE: 'ROLE',
  USER: 'USER',
  TEAM_MANAGER: 'TEAM_MANAGER',
} as const;
export type IncentiveAppliesTo = (typeof IncentiveAppliesTo)[keyof typeof IncentiveAppliesTo];
export const INCENTIVE_APPLIES_TO = Object.values(IncentiveAppliesTo);

/** A PREVIEW is recomputed at will; APPROVED and EXPORTED are frozen. */
export const IncentiveRunStatus = {
  PREVIEW: 'PREVIEW',
  APPROVED: 'APPROVED',
  EXPORTED: 'EXPORTED',
} as const;
export type IncentiveRunStatus = (typeof IncentiveRunStatus)[keyof typeof IncentiveRunStatus];
export const INCENTIVE_RUN_STATUSES = Object.values(IncentiveRunStatus);

// ---------------------------------------------------------------- DRH (phase 31)

export const EmployeeContract = {
  CDI: 'CDI',
  CDD: 'CDD',
  JOURNALIER: 'JOURNALIER',
} as const;
export type EmployeeContract = (typeof EmployeeContract)[keyof typeof EmployeeContract];
export const EMPLOYEE_CONTRACTS = Object.values(EmployeeContract);

/** Salaire de base (per month) or salaire journalier (per day). */
export const PayType = {
  MONTHLY: 'MONTHLY',
  DAILY: 'DAILY',
} as const;
export type PayType = (typeof PayType)[keyof typeof PayType];
export const PAY_TYPES = Object.values(PayType);

/** What happened on a day. Append-only: a mistake is fixed by a `CORRECTION`, never an update. */
export const AttendanceEventKind = {
  PRESENT: 'PRESENT',
  ABSENT: 'ABSENT',
  HALF_DAY: 'HALF_DAY',
  /** Came late: the worker is present, `lateMinutes` says by how much. */
  LATE: 'LATE',
  CHECK_IN: 'CHECK_IN',
  CHECK_OUT: 'CHECK_OUT',
  OVERTIME: 'OVERTIME',
  CORRECTION: 'CORRECTION',
} as const;
export type AttendanceEventKind = (typeof AttendanceEventKind)[keyof typeof AttendanceEventKind];
export const ATTENDANCE_EVENT_KINDS = Object.values(AttendanceEventKind);

export const AttendanceSource = {
  /** Marked from the "Pointage du jour" screen. */
  MANAGER: 'MANAGER',
  /** The employee's own phone. */
  SELF: 'SELF',
  IMPORT: 'IMPORT',
} as const;
export type AttendanceSource = (typeof AttendanceSource)[keyof typeof AttendanceSource];
export const ATTENDANCE_SOURCES = Object.values(AttendanceSource);

export const AbsenceReason = {
  /** Authorised, unpaid. */
  JUSTIFIED: 'JUSTIFIED',
  /** Arrêt maladie. */
  SICK: 'SICK',
  UNJUSTIFIED: 'UNJUSTIFIED',
} as const;
export type AbsenceReason = (typeof AbsenceReason)[keyof typeof AbsenceReason];
export const ABSENCE_REASONS = Object.values(AbsenceReason);

/** The status of an employee's day, always derived (`attendance.ts`). */
export const DayStatus = {
  PRESENT: 'PRESENT',
  ABSENT_UNJUSTIFIED: 'ABSENT_UNJUSTIFIED',
  ABSENT_JUSTIFIED: 'ABSENT_JUSTIFIED',
  SICK: 'SICK',
  LEAVE_PAID: 'LEAVE_PAID',
  LEAVE_UNPAID: 'LEAVE_UNPAID',
  HALF_DAY: 'HALF_DAY',
  REST: 'REST',
  HOLIDAY: 'HOLIDAY',
  /** Before the hire date or after the exit date. */
  NOT_EMPLOYED: 'NOT_EMPLOYED',
  /** Nobody said anything: never counted as present. */
  UNMARKED: 'UNMARKED',
} as const;
export type DayStatus = (typeof DayStatus)[keyof typeof DayStatus];
export const DAY_STATUSES = Object.values(DayStatus);

/** What a correction may set a day to. `UNMARKED` undoes a wrong tap. */
export const CORRECTABLE_STATUSES = [
  DayStatus.PRESENT,
  DayStatus.ABSENT_UNJUSTIFIED,
  DayStatus.ABSENT_JUSTIFIED,
  DayStatus.SICK,
  DayStatus.HALF_DAY,
  DayStatus.UNMARKED,
] as const;
export type CorrectableStatus = (typeof CORRECTABLE_STATUSES)[number];

export const LeaveType = {
  PAID: 'PAID',
  UNPAID: 'UNPAID',
  SICK: 'SICK',
  OTHER: 'OTHER',
} as const;
export type LeaveType = (typeof LeaveType)[keyof typeof LeaveType];
export const LEAVE_TYPES = Object.values(LeaveType);

export const LeaveRequestStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;
export type LeaveRequestStatus = (typeof LeaveRequestStatus)[keyof typeof LeaveRequestStatus];
export const LEAVE_REQUEST_STATUSES = Object.values(LeaveRequestStatus);

/** The congé ledger, in days. Balance = sum of the signed entries. */
export const LeaveEntryType = {
  ACCRUAL: 'ACCRUAL',
  TAKEN: 'TAKEN',
  ADJUST: 'ADJUST',
  OPENING: 'OPENING',
} as const;
export type LeaveEntryType = (typeof LeaveEntryType)[keyof typeof LeaveEntryType];

/** The employee's account. Phase 31b adds `SALARY_DUE` and `SALARY_PAID`. */
export const EmployeeLedgerType = {
  ADVANCE: 'ADVANCE',
  REVERSAL: 'REVERSAL',
  /** An avance already running when the company started (Excel import): no dépense behind it. */
  OPENING: 'OPENING',
  /** Phase 31b: an approved payslip, what the company now owes the worker. */
  SALARY_DUE: 'SALARY_DUE',
  /** Phase 31b: a salary payment, linked to its dépense. */
  SALARY_PAID: 'SALARY_PAID',
  /** Phase 31b: an avance taken back from a payslip; moves both balances. */
  ADVANCE_DEDUCTION: 'ADVANCE_DEDUCTION',
  /** Phase 31b: undoes a SALARY_DUE (run cancelled) or a SALARY_PAID (dépense cancelled). */
  SALARY_REVERSAL: 'SALARY_REVERSAL',
} as const;
export type EmployeeLedgerType = (typeof EmployeeLedgerType)[keyof typeof EmployeeLedgerType];

// Paie (phase 31b).

export const PayrollRunStatus = {
  DRAFT: 'DRAFT',
  APPROVED: 'APPROVED',
  CANCELLED: 'CANCELLED',
} as const;
export type PayrollRunStatus = (typeof PayrollRunStatus)[keyof typeof PayrollRunStatus];
export const PAYROLL_RUN_STATUSES = Object.values(PayrollRunStatus);

/** A prime is a fixed amount, or an amount per day present (panier, transport). */
export const PayItemMode = { FIXED: 'FIXED', PER_DAY: 'PER_DAY' } as const;
export type PayItemMode = (typeof PayItemMode)[keyof typeof PayItemMode];
export const PAY_ITEM_MODES = Object.values(PayItemMode);

/** What a line entered by hand on a draft run is. */
export const PayrollManualKind = {
  /** A one-off prime of a tenant type. */
  ITEM: 'ITEM',
  /** Fixes a past month: signed, never a reopening of the run. */
  REGULARISATION: 'REGULARISATION',
  /** Comes off the net à payer, with a note. */
  RETENUE: 'RETENUE',
} as const;
export type PayrollManualKind = (typeof PayrollManualKind)[keyof typeof PayrollManualKind];
export const PAYROLL_MANUAL_KINDS = Object.values(PayrollManualKind);

/** Every line of a payslip: the screen translates the code, the PDF prints the frozen label. */
export const PayLineCode = {
  BASE_SALARY: 'BASE_SALARY',
  DAYS_WORKED: 'DAYS_WORKED',
  LEAVE_PAID: 'LEAVE_PAID',
  HOLIDAY_PAID: 'HOLIDAY_PAID',
  ABSENCE_UNJUSTIFIED: 'ABSENCE_UNJUSTIFIED',
  ABSENCE_JUSTIFIED: 'ABSENCE_JUSTIFIED',
  HALF_DAY: 'HALF_DAY',
  LEAVE_UNPAID: 'LEAVE_UNPAID',
  SICK: 'SICK',
  NOT_EMPLOYED: 'NOT_EMPLOYED',
  LATENESS: 'LATENESS',
  REST_WORKED: 'REST_WORKED',
  OVERTIME: 'OVERTIME',
  ITEM: 'ITEM',
  INCENTIVE: 'INCENTIVE',
  REGULARISATION: 'REGULARISATION',
  CNAS_EMPLOYEE: 'CNAS_EMPLOYEE',
  IRG: 'IRG',
  RETENUE: 'RETENUE',
  ADVANCE: 'ADVANCE',
} as const;
export type PayLineCode = (typeof PayLineCode)[keyof typeof PayLineCode];
export const PAY_LINE_CODES = Object.values(PayLineCode);
