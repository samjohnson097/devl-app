import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase';
import { ensureFreshSession, sessionNeedsRefresh } from './sessionRefresh';

type AuthState = {
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider(props: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    const sb = requireSupabase();
    let cancelled = false;

    (async () => {
      const fresh = await ensureFreshSession(sb);
      if (!cancelled) {
        setSession(fresh);
        setLoading(false);
      }
    })();

    const { data: sub } = sb.auth.onAuthStateChange((event, next) => {
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
        setSession(next);
        return;
      }
      if (event === 'SIGNED_OUT') {
        setSession(null);
        return;
      }
      setSession(next);
    });

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void (async () => {
        const { data: { session } } = await sb.auth.getSession();
        if (!session || !sessionNeedsRefresh(session)) return;
        const fresh = await ensureFreshSession(sb);
        if (!cancelled) setSession(fresh);
      })();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const signOut = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    await requireSupabase().auth.signOut();
  }, []);

  const value = useMemo(
    () => ({ session, loading, signOut }),
    [session, loading, signOut]
  );

  return (
    <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
