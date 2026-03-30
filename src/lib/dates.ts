/** Ordinal suffix for day of month (1 → st, 22 → nd). */
export function ordinalSuffix(day: number): string {
  const j = day % 10;
  const k = day % 100;
  if (j === 1 && k !== 11) return 'st';
  if (j === 2 && k !== 12) return 'nd';
  if (j === 3 && k !== 13) return 'rd';
  return 'th';
}

/**
 * Format calendar date string `YYYY-MM-DD` as e.g. "March 23rd" (local calendar day).
 */
export function formatOrdinalLongDate(isoDate: string): string {
  const parts = isoDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    return isoDate;
  }
  const [y, mo, d] = parts;
  const date = new Date(y, mo - 1, d);
  const month = date.toLocaleString('en-US', { month: 'long' });
  return `${month} ${d}${ordinalSuffix(d)}`;
}

export function weekdayLong(isoDate: string): string {
  const parts = isoDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    return '';
  }
  const [y, mo, d] = parts;
  const date = new Date(y, mo - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}

/** Local calendar date as `YYYY-MM-DD` (safe to compare with Postgres `date` strings). */
export function localIsoDateString(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
