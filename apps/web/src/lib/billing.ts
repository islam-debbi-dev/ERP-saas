'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OnboardingStatus, SubscriptionSummary } from '@erp/shared';
import { api } from './api-client';

export const billingKeys = {
  subscription: ['subscription'] as const,
  onboarding: ['onboarding'] as const,
};

/** Status, plan, usage and payments. The banner and the Abonnement page share it. */
export function useSubscription(enabled = true) {
  return useQuery({
    queryKey: billingKeys.subscription,
    queryFn: () => api.request<SubscriptionSummary>('/tenant/subscription'),
    enabled,
    // The status changes with the date: re-check every few minutes on an open tab.
    refetchInterval: 5 * 60_000,
  });
}

export function useOnboarding(enabled: boolean) {
  return useQuery({
    queryKey: billingKeys.onboarding,
    queryFn: () => api.request<OnboardingStatus>('/dashboard/onboarding'),
    enabled,
  });
}

export function useDismissOnboarding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.request<void>('/dashboard/onboarding/dismiss', { method: 'POST' }),
    onSuccess: () => {
      queryClient.setQueryData<OnboardingStatus>(billingKeys.onboarding, (old) =>
        old ? { ...old, dismissed: true } : old,
      );
    },
  });
}
