/**
 * Per-user browser preference: which season slug is pre-selected on the league home page.
 * Keyed by Supabase auth user id (separate admins on the same machine get their own default).
 */
function storageKey(userId: string): string {
  return `devl:adminDefaultSeasonSlug:${userId}`;
}

export function getDefaultSeasonSlug(userId: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(userId));
  } catch {
    return null;
  }
}

/** Pass empty string or null to clear. */
export function setDefaultSeasonSlug(userId: string, slug: string | null): void {
  try {
    const k = storageKey(userId);
    if (slug == null || slug === '') {
      window.localStorage.removeItem(k);
    } else {
      window.localStorage.setItem(k, slug);
    }
  } catch {
    // ignore quota / private mode
  }
}
