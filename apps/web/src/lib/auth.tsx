'use client';

import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthResponse, AuthUser, LoginInput, RegisterInput } from '@erp/shared';
import { api, ApiError } from './api-client';

type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'authenticated'; user: AuthUser }
  | { status: 'anonymous'; user: null };

interface AuthContextValue {
  state: AuthState;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function deviceName(): string {
  return typeof navigator === 'undefined' ? 'Navigateur' : `Navigateur – ${navigator.platform}`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null });

  const accept = useCallback((auth: AuthResponse) => {
    api.setAccessToken(auth.accessToken);
    setState({ status: 'authenticated', user: auth.user });
  }, []);

  // On load, the httpOnly refresh cookie (if any) restores the session.
  useEffect(() => {
    let cancelled = false;
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
        try {
          await api.request('/auth/logout', { method: 'POST' });
        } catch (err) {
          // Already logged out server-side: nothing else to do.
          if (!(err instanceof ApiError)) throw err;
        }
        api.setAccessToken(null);
        queryClient.clear();
        setState({ status: 'anonymous', user: null });
      },
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
