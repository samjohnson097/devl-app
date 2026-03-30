/** PostgREST / Supabase error when the JWT is expired (browser tab idle, etc.). */
export function isJwtExpiredError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const o = err as { code?: string; message?: string };
  if (o.code === 'PGRST303') return true;
  const msg = (o.message ?? '').toLowerCase();
  return msg.includes('jwt expired') || msg.includes('jwt is expired');
}
