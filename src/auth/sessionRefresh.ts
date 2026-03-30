import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { isJwtExpiredError } from './authErrors';

/** Refresh if access token is missing or expires within this many seconds. */
const REFRESH_BUFFER_SEC = 120;

export function sessionNeedsRefresh(session: Session | null): boolean {
  if (!session?.expires_at) return false;
  const expMs = session.expires_at * 1000;
  return expMs < Date.now() + REFRESH_BUFFER_SEC * 1000;
}

/**
 * Returns a usable session, refreshing the JWT when needed.
 * If refresh fails (e.g. refresh token expired), signs out and returns null.
 */
export async function ensureFreshSession(
  sb: SupabaseClient
): Promise<Session | null> {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;

  if (!sessionNeedsRefresh(session)) {
    return session;
  }

  const { data, error } = await sb.auth.refreshSession();
  if (error || !data.session) {
    await sb.auth.signOut();
    return null;
  }
  return data.session;
}

/** Run a Supabase-backed call; on JWT expiry, refresh once and retry. */
export async function withJwtRetry<T>(
  sb: SupabaseClient,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isJwtExpiredError(e)) throw e;
    await ensureFreshSession(sb);
    return await fn();
  }
}
