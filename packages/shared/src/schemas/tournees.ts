import { z } from 'zod';
import {
  NO_SALE_REASONS,
  NoSaleReason,
  ORDER_STATUSES,
  PAYMENT_MODES,
  VISIT_OUTCOMES,
  VisitOutcome,
  type NoSaleReason as NoSaleReasonValue,
  type OrderStatus,
  type SellerSessionStatus,
  type VisitOutcome as VisitOutcomeValue,
} from '../enums';
import { amountString, normalizeDecimal, quantityString } from './common';
import { saleLineInputSchema, type SaleWarning } from './sales';

const id = z.uuid();
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date');
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .default(null);
const reason = z.string().trim().min(3).max(255);

interface UserRef {
  id: string;
  fullName: string;
}

// ---------------------------------------------------------------- routes (tournées)

/** 0 = Sunday … 6 = Saturday (Algerian week), each day once, sorted. */
const weekdays = z
  .array(z.number().int().min(0).max(6))
  .min(1)
  .max(7)
  .transform((days) => [...new Set(days)].sort((a, b) => a - b));

export const createRouteSchema = z.object({
  name: z.string().trim().min(1).max(80),
  sellerId: id,
  weekdays,
  active: z.boolean().default(true),
});
export type CreateRouteInput = z.infer<typeof createRouteSchema>;

export const updateRouteSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    sellerId: id,
    weekdays,
    active: z.boolean(),
  })
  .partial()
  .strict();
export type UpdateRouteInput = z.infer<typeof updateRouteSchema>;

/** The whole ordered list of stops; replaces the previous one. */
export const setRouteStopsSchema = z.object({
  clientIds: z
    .array(id)
    .max(300)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'duplicate_client' }),
});
export type SetRouteStopsInput = z.infer<typeof setRouteStopsSchema>;

export const routeListQuerySchema = z.object({
  sellerId: id.optional(),
  /** Only routes that run on this weekday. */
  weekday: z.coerce.number().int().min(0).max(6).optional(),
});
export type RouteListQuery = z.infer<typeof routeListQuerySchema>;

export interface RouteStopDto {
  position: number;
  client: { id: string; code: string; name: string; commune: string | null; phone: string | null };
}

export interface RouteDto {
  id: string;
  name: string;
  seller: UserRef;
  weekdays: number[];
  active: boolean;
  stopCount: number;
  /** Filled on the detail, empty in lists. */
  stops: RouteStopDto[];
}

// ---------------------------------------------------------------- seller today

export interface TodayStopDto {
  routeId: string;
  position: number;
  client: {
    id: string;
    code: string;
    name: string;
    phone: string | null;
    address: string | null;
    commune: string | null;
  };
  balance: string;
  lastVisit: {
    id: string;
    outcome: VisitOutcomeValue;
    reason: NoSaleReasonValue | null;
    startedAt: string;
  } | null;
  lastSale: { id: string; number: string | null; totalTtc: string; validatedAt: string } | null;
  /** A visit was recorded for this client today (Algiers day). */
  visitedToday: boolean;
  /** The caller's latest documents for this client today, to link to the visit. */
  today: { saleId: string | null; orderId: string | null; paymentId: string | null };
}

export interface TodayDto {
  /** Algiers day, `YYYY-MM-DD`. */
  day: string;
  weekday: number;
  routes: { id: string; name: string }[];
  /** A client on two of today's routes appears once, at his first route. */
  stops: TodayStopDto[];
  planned: number;
  visited: number;
}

// ---------------------------------------------------------------- visits

export const createVisitSchema = z
  .object({
    clientId: id,
    routeId: id.nullable().default(null),
    /** Office roles may record for a seller; a SELLER always records his own. */
    sellerId: id.optional(),
    startedAt: z.iso.datetime({ offset: true }),
    endedAt: z.iso.datetime({ offset: true }).nullable().default(null),
    outcome: z.enum(VISIT_OUTCOMES),
    reason: z.enum(NO_SALE_REASONS).nullable().default(null),
    note: optionalText(255),
    saleId: id.nullable().default(null),
    orderId: id.nullable().default(null),
    paymentId: id.nullable().default(null),
    /** This visit replaces an earlier one (never edited in place). */
    correctsVisitId: id.nullable().default(null),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', message, path: [path] });
    if (v.outcome === VisitOutcome.NO_SALE) {
      if (!v.reason) issue('reason', 'reason_required');
      if (v.reason === NoSaleReason.OTHER && !v.note) issue('note', 'note_required');
    } else if (v.reason) {
      issue('reason', 'reason_no_sale_only');
    }
    // The document behind the outcome, so reports and bonuses count real sales.
    if (v.outcome === VisitOutcome.SALE && !v.saleId) issue('saleId', 'sale_required');
    if (v.outcome === VisitOutcome.ORDER && !v.orderId) issue('orderId', 'order_required');
    if (v.outcome === VisitOutcome.PAYMENT_ONLY && !v.paymentId) {
      issue('paymentId', 'payment_required');
    }
    if (v.endedAt && v.endedAt < v.startedAt) issue('endedAt', 'ends_before_start');
  });
export type CreateVisitInput = z.infer<typeof createVisitSchema>;

export const visitListQuerySchema = z.object({
  sellerId: id.optional(),
  clientId: id.optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type VisitListQuery = z.infer<typeof visitListQuerySchema>;

export interface VisitDto {
  id: string;
  seller: UserRef;
  client: { id: string; code: string; name: string };
  routeId: string | null;
  startedAt: string;
  endedAt: string | null;
  outcome: VisitOutcomeValue;
  reason: NoSaleReasonValue | null;
  note: string | null;
  saleId: string | null;
  orderId: string | null;
  paymentId: string | null;
  correctsVisitId: string | null;
  /** A later visit corrects this one: it no longer counts. */
  corrected: boolean;
  createdAt: string;
}

export interface VisitPage {
  items: VisitDto[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------- bons de commande

const orderFields = {
  clientId: id,
  /** Office roles pick the seller; a SELLER's orders are always his. */
  sellerId: id.nullable().optional(),
  /** Dépôt to deliver from. null = decided at delivery (livreur's truck, else MAIN). */
  warehouseId: id.nullable().default(null),
  requestedDate: dateString.nullable().default(null),
  note: optionalText(255),
  lines: z.array(saleLineInputSchema).max(300),
};

export const createOrderSchema = z.object(orderFields);
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const updateOrderSchema = z.object({ ...orderFields, version: z.number().int().min(1) });
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;

export const assignLivreurSchema = z.object({ livreurId: id.nullable() });
export type AssignLivreurInput = z.infer<typeof assignLivreurSchema>;

export const cancelOrderSchema = z.object({ reason });
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

export const deliverOrderSchema = z.object({
  /** Quantity actually delivered per line, in the line's unit. Omitted line = 0. */
  lines: z
    .array(
      z.object({
        orderLineId: id,
        qty: quantityString({ positive: false }).transform(normalizeDecimal),
      }),
    )
    .min(1)
    .max(300)
    .refine((ls) => new Set(ls.map((l) => l.orderLineId)).size === ls.length, {
      message: 'duplicate_line',
    }),
  paidAmount: amountString.transform(normalizeDecimal).default('0'),
  paymentMode: z.enum(PAYMENT_MODES).default('ESPECES'),
  forceCredit: z.boolean().default(false),
});
export type DeliverOrderInput = z.infer<typeof deliverOrderSchema>;

export const orderListQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  sellerId: id.optional(),
  livreurId: id.optional(),
  clientId: id.optional(),
  /** Requested delivery date range. */
  from: dateString.optional(),
  to: dateString.optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

export interface OrderLineDto {
  id: string;
  position: number;
  productId: string;
  reference: string;
  designation: string;
  unitId: string;
  unitCode: string;
  factorToBase: string;
  qty: string;
  qtyBase: string;
  unitPriceHt: string;
  discountPct: string;
  tvaRate: string;
  lineHt: string;
  qtyDelivered: string | null;
  qtyNotDelivered: string | null;
  /** Stock available now in the delivery dépôt (base unit), for information only. */
  availableBase: string;
}

export interface OrderDto {
  id: string;
  number: string | null;
  status: OrderStatus;
  client: { id: string; code: string; name: string; phone: string | null };
  seller: UserRef | null;
  livreur: UserRef | null;
  warehouse: { id: string; name: string } | null;
  requestedDate: string | null;
  note: string | null;
  /** The tenant's TVA regime when the order was last priced. */
  assujettiTva: boolean;
  totalHt: string;
  totalTva: string;
  totalTtc: string;
  sale: { id: string; number: string | null } | null;
  cancelReason: string | null;
  createdAt: string;
  confirmedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  version: number;
  lines: OrderLineDto[];
}

export interface OrderSummaryDto {
  id: string;
  number: string | null;
  status: OrderStatus;
  client: { id: string; code: string; name: string };
  seller: UserRef | null;
  livreur: UserRef | null;
  requestedDate: string | null;
  totalTtc: string;
  lineCount: number;
  /** Lines whose ordered quantity is above the dépôt's stock right now. */
  shortLines: number;
  sale: { id: string; number: string | null } | null;
  createdAt: string;
}

export interface OrderPage {
  items: OrderSummaryDto[];
  nextCursor: string | null;
}

/** Who can be put on an order to deliver it. */
export interface DelivererDto {
  id: string;
  fullName: string;
  role: 'LIVREUR' | 'SELLER';
}

export interface DeliverOrderResultDto {
  order: OrderDto;
  sale: { id: string; number: string | null; totalTtc: string };
  warnings: SaleWarning[];
  change: string;
}

// ---------------------------------------------------------------- clôture de tournée

export const openSellerSessionSchema = z.object({
  sellerId: id,
  /** Algiers day; omitted = today. */
  date: dateString.optional(),
});
export type OpenSellerSessionInput = z.infer<typeof openSellerSessionSchema>;

export const closeSellerSessionSchema = z.object({
  handedCash: amountString.transform(normalizeDecimal),
  note: optionalText(255),
});
export type CloseSellerSessionInput = z.infer<typeof closeSellerSessionSchema>;

/** A correction after closing: a new row, the closed session never changes. */
export const adjustSellerSessionSchema = z.object({
  /** The amount counted again, if it changed. */
  handedCash: amountString.transform(normalizeDecimal).nullable().default(null),
  note: reason,
});
export type AdjustSellerSessionInput = z.infer<typeof adjustSellerSessionSchema>;

export const sellerSessionListQuerySchema = z.object({ date: dateString.optional() });
export type SellerSessionListQuery = z.infer<typeof sellerSessionListQuerySchema>;

export interface ExpectedCashDto {
  /** Cash part of the sales he collected himself. */
  fromSales: string;
  /** Cash versements he collected. */
  fromVersements: string;
  total: string;
}

export interface SellerSessionAdjustmentDto {
  id: string;
  handedCash: string | null;
  ecart: string | null;
  note: string | null;
  by: UserRef | null;
  at: string;
}

export interface SellerSessionDto {
  id: string;
  seller: UserRef;
  date: string;
  status: SellerSessionStatus;
  warehouse: { id: string; name: string } | null;
  /** Frozen at closing; computed live while OPEN. */
  expected: ExpectedCashDto;
  handedCash: string | null;
  ecart: string | null;
  note: string | null;
  closedBy: UserRef | null;
  closedAt: string | null;
  adjustments: SellerSessionAdjustmentDto[];
}

/** One line of the clôture screen: a seller and his day, session or not. */
export interface SellerDayDto {
  seller: UserRef;
  date: string;
  session: SellerSessionDto | null;
  /** Live figure (same rule as at closing). */
  expected: ExpectedCashDto;
  vehicle: { id: string; name: string } | null;
}

export interface VehicleStockLineDto {
  productId: string;
  reference: string;
  designation: string;
  unitId: string;
  unitCode: string;
  qtyBase: string;
}

export interface SellerSessionCloseResultDto {
  session: SellerSessionDto;
  /** What is left on the truck, to offer a déchargement. Empty without a truck. */
  vehicleStock: VehicleStockLineDto[];
}

// ---------------------------------------------------------------- reports

export const tourneeReportQuerySchema = z
  .object({
    from: dateString,
    to: dateString,
    sellerId: id.optional(),
  })
  .refine((q) => q.from <= q.to, { message: 'from_after_to', path: ['to'] });
export type TourneeReportQuery = z.infer<typeof tourneeReportQuerySchema>;

export interface TourneeReportRowDto {
  seller: UserRef;
  /** Stops of the seller's routes, summed over each day of the period. */
  plannedStops: number;
  visitedStops: number;
  /** visitedStops / plannedStops, 0..1; null without planned stops. */
  visitRate: number | null;
  visits: number;
  /** Visits with a sale or an order. */
  productiveVisits: number;
  /** productiveVisits / visits, 0..1; null without visits. */
  strikeRate: number | null;
  noSale: Record<NoSaleReasonValue, number>;
  orders: number;
  ordersTtc: string;
  delivered: number;
  deliveredTtc: string;
  /** Order lines delivered short (rupture). */
  shortLines: number;
  closings: number;
  /** Sum of the écarts of his closed sessions (adjustments included). */
  ecart: string;
}

export interface TourneeReportDto {
  from: string;
  to: string;
  rows: TourneeReportRowDto[];
}
