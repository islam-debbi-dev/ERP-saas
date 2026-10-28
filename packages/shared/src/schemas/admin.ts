import { z } from 'zod';
import {
  SUBSCRIPTION_PAYMENT_METHODS,
  type SubscriptionPaymentMethod,
  type SubscriptionStatus,
  SubscriptionStatus as Status,
} from '../subscription';
import { emailField } from './auth';
import type { PlanInfo, PlanUsage, SubscriptionSummary } from './billing';
import { amountString } from './common';

/** Super-admin login: password and the 6-digit code of the authenticator app (TOTP). */
export const adminLoginSchema = z.object({
  email: emailField,
  password: z.string().min(1).max(128),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'invalid_code'),
  deviceName: z.string().trim().max(100).optional(),
});
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;

export interface AdminInfo {
  id: string;
  email: string;
  fullName: string;
}

export interface AdminAuthResponse {
  accessToken: string;
  expiresIn: number;
  admin: AdminInfo;
}

export const adminTenantsQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(Object.values(Status) as [SubscriptionStatus, ...SubscriptionStatus[]]).optional(),
});
export type AdminTenantsQuery = z.infer<typeof adminTenantsQuerySchema>;

export interface AdminTenantRow {
  id: string;
  name: string;
  planName: string;
  status: SubscriptionStatus;
  isFree: boolean;
  currentPeriodEnd: string;
  usage: PlanUsage;
  createdAt: string;
  /** Last request of any user of the tenant (session lastUsedAt). */
  lastActivityAt: string | null;
}

export interface AdminTenantDetail extends SubscriptionSummary {
  id: string;
  name: string;
  raisonSociale: string;
  telephone: string | null;
  owner: { fullName: string; email: string | null; phone: string | null } | null;
  createdAt: string;
  lastActivityAt: string | null;
  plans: PlanInfo[];
}

export const recordSubscriptionPaymentSchema = z.object({
  amount: amountString,
  method: z.enum(
    SUBSCRIPTION_PAYMENT_METHODS as [SubscriptionPaymentMethod, ...SubscriptionPaymentMethod[]],
  ),
  months: z.number().int().min(1).max(24),
  reference: z
    .string()
    .trim()
    .max(80)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .default(null),
});
export type RecordSubscriptionPaymentInput = z.infer<typeof recordSubscriptionPaymentSchema>;

/** Change plan, switch free (pilot) on or off, or give more trial days. */
export const updateSubscriptionSchema = z
  .object({
    planId: z.uuid().optional(),
    isFree: z.boolean().optional(),
    extendTrialDays: z.number().int().min(1).max(90).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'empty' });
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>;

export interface ImpersonationResponse {
  accessToken: string;
  expiresIn: number;
  tenantName: string;
}
