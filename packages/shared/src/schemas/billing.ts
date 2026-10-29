import type { Edition, Feature } from '../features';
import type {
  StoredSubscriptionStatus,
  SubscriptionPaymentMethod,
  SubscriptionStatus,
} from '../subscription';

/** A plan as shown to tenants and to the super-admin. Limits are null when unlimited. */
export interface PlanInfo {
  id: string;
  code: string;
  name: string;
  /** DZD per month, `"4500.00"`. */
  monthlyPrice: string;
  maxUsers: number | null;
  maxProducts: number | null;
  maxDocumentsPerMonth: number | null;
  /** Sellers on the mobile app (phase 19). */
  maxMobileSellers: number | null;
}

/** An edition and what it adds to the plan's monthly price. */
export interface EditionInfo {
  edition: Edition;
  /** DZD per month on top of the plan, `"0.00"`. */
  monthlySupplement: string;
  features: Feature[];
}

export interface PlanUsage {
  users: number;
  products: number;
  /** Sales (BL + factures) created this calendar month, Algiers time. */
  documentsThisMonth: number;
}

export interface SubscriptionPaymentInfo {
  id: string;
  amount: string;
  method: SubscriptionPaymentMethod;
  reference: string | null;
  months: number;
  periodFrom: string;
  periodTo: string;
  createdAt: string;
}

export interface SubscriptionSummary {
  plan: PlanInfo;
  edition: EditionInfo;
  /** Super-admin overrides on top of the edition. */
  featureGrants: Feature[];
  featureRevokes: Feature[];
  /** Edition + grants − revokes. */
  features: Feature[];
  /** Derived from the dates: TRIAL, ACTIVE, PAST_DUE or SUSPENDED. */
  status: SubscriptionStatus;
  storedStatus: StoredSubscriptionStatus;
  /** Pilot tenant: never billed, never suspended. */
  isFree: boolean;
  currentPeriodEnd: string;
  /** When PAST_DUE turns into SUSPENDED. */
  graceEndsAt: string;
  /** Days left in the period (TRIAL / ACTIVE) or in the grace (PAST_DUE). */
  daysLeft: number;
  usage: PlanUsage;
  /** Soft limit: documents over the plan's monthly count only warn. */
  docsOverLimit: boolean;
  payments: SubscriptionPaymentInfo[];
}

export const ONBOARDING_STEPS = [
  'companyInfo',
  'products',
  'clientBalances',
  'users',
  'firstSale',
] as const;
export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingStatus {
  steps: { key: OnboardingStepKey; done: boolean }[];
  completed: boolean;
  dismissed: boolean;
}
