export function formatAppError(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const o = err as {
      message: string;
      details?: string;
      hint?: string;
      code?: string;
    };
    const parts = [o.message];
    if (o.details) parts.push(o.details);
    if (o.hint) parts.push(o.hint);
    if (o.code) parts.push(`[${o.code}]`);
    return parts.join(' — ');
  }
  return String(err);
}
