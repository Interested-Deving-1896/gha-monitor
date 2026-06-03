import type { TimeWindow } from './types.js';

interface WindowOpts {
  days?: number;
  month?: number;
  year?: number;
}

/** Returns number of days in a given UTC month (month is 1-12). */
export function daysInMonth(year: number, month: number): number {
  // Passing day=0 to the next month gives the last day of the current month
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Resolve window options into a TimeWindow.
 * All date math in UTC.
 *
 * If days is provided: window ends today, starts (today - days + 1).
 *   sinceISO = first day of the window as YYYY-MM-DD
 *   year/month = of today
 *   daysInWindow = days
 *
 * If month+year provided: window is the full calendar month.
 *   sinceISO = YYYY-MM-01
 *   day = undefined
 *   daysInWindow = days in that calendar month
 *
 * Default (neither provided): treat as --days 7
 */
export function resolveWindow(opts: WindowOpts, now: Date = new Date()): TimeWindow {
  // Full calendar month mode
  if (opts.month !== undefined && opts.year !== undefined) {
    const { month, year } = opts;
    const dim = daysInMonth(year, month);
    const mm = String(month).padStart(2, '0');
    return {
      year,
      month,
      sinceISO: `${year}-${mm}-01`,
      daysInWindow: dim,
    };
  }

  // Rolling window mode (default to 7 days)
  const days = opts.days ?? 7;
  const todayYear = now.getUTCFullYear();
  const todayMonth = now.getUTCMonth() + 1; // 1-12
  const todayDay = now.getUTCDate();

  // Start date: today - (days - 1) days
  const startTs = Date.UTC(todayYear, todayMonth - 1, todayDay - (days - 1));
  const startDate = new Date(startTs);
  const sy = startDate.getUTCFullYear();
  const sm = String(startDate.getUTCMonth() + 1).padStart(2, '0');
  const sd = String(startDate.getUTCDate()).padStart(2, '0');

  return {
    year: todayYear,
    month: todayMonth,
    day: todayDay,
    sinceISO: `${sy}-${sm}-${sd}`,
    daysInWindow: days,
  };
}
