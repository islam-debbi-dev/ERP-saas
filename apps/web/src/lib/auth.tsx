'use client';

import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthResponse, AuthUser, LoginInput, Permission, RegisterInput } from '@erp/shared';
import { api, ApiError } from './api-client';
import { impersonation } from './impersonation';
import { sessionHint } from './session-hint';

type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'authenticated'; user: AuthUser }
  | { status: 'anonymous'; user: null };

interface AuthContextValue {
  state: AuthState;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  /** Logged in by another route (invitation link). */
  acceptAuth: (auth: AuthResponse) => void;
  /** The user changed (password changed, so no longer a temporary one). */
  updateUser: (user: AuthUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function deviceName(): string {
  return typeof navigator === 'undefined' ? 'Web' : `Web – ${navigator.platform}`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null });

  const accept = useCallback((auth: AuthResponse) => {
    api.setAccessToken(auth.accessToken);
    sessionHint.set(true);
    setState({ status: 'authenticated', user: auth.user });
  }, []);

  // On load, the httpOnly refresh cookie (if any) restores the session.
  useEffect(() => {
    let cancelled = false;
    // A support view (super-admin, read-only) in this tab: its own token, no cookie.
    const supportToken = impersonation.get();
    if (supportToken) {
      api.useFixedToken(supportToken);
      api
        .request<AuthUser>('/auth/me')
        .then((user) => {
          if (!cancelled) setState({ status: 'authenticated', user });
        })
        .catch(() => {
          if (!cancelled) setState({ status: 'anonymous', user: null });
        });
      return () => {
        cancelled = true;
      };
    }
    if (!sessionHint.get()) {
      // Logged out on this browser: no session to restore.
      queueMicrotask(() => setState({ status: 'anonymous', user: null }));
      return;
    }
    api
      .refresh()
      .then((auth) => {
        if (!cancelled) accept(auth);
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'anonymous', user: null });
      });
    return () => {
      cancelled = true;
    };
  }, [accept]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      login: async (input) => {
        accept(
          await api.request<AuthResponse>('/auth/login', {
            method: 'POST',
            body: { ...input, deviceName: deviceName() },
          }),
        );
      },
      register: async (input) => {
        accept(
          await api.request<AuthResponse>('/auth/register', {
            method: 'POST',
            body: { ...input, deviceName: deviceName() },
          }),
        );
      },
      logout: async () => {
        if (impersonation.get()) {
          // A support view has no session of its own to close: just leave it.
          impersonation.clear();
          // Full reload: the tab forgets the support token and every cached query.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign('/support?ended=1');
          return;
        }
        try {
          await api.request('/auth/logout', { method: 'POST' });
        } catch (err) {
          // Already logged out server-side: nothing else to do.
          if (!(err instanceof ApiError)) throw err;
        }
        api.setAccessToken(null);
        sessionHint.set(false);
        queryClient.clear();
        setState({ status: 'anonymous', user: null });
      },
      acceptAuth: accept,
      updateUser: (user) => setState({ status: 'authenticated', user }),
    }),
    [state, accept, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/**
 * Whether the logged-in user has this permission. Only hides buttons: the API
 * checks again and stays the guard.
 */
export function usePermission(permission: Permission): boolean {
  const { state } = useAuth();
  return state.status === 'authenticated' && state.user.permissions.includes(permission);
}
