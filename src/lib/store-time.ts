/**
 * The store works on America/Sao_Paulo time (no DST since 2019). Every report
 * that groups by day or month must cut at the store's midnight, not at UTC's.
 */
export const STORE_TZ_OFFSET = "-03:00";

/** Converts a store-local calendar date (YYYY-MM-DD) to the UTC instant of its start (or last millisecond). */
export function localDateToUtc(dateStr: string, endOfDay = false): Date {
  const time = endOfDay ? "23:59:59.999" : "00:00:00";
  return new Date(`${dateStr}T${time}${STORE_TZ_OFFSET}`);
}
