import { describe, it, expect } from 'vitest';
import { resolveWindow, daysInMonth } from './window.js';

// Fixed "now" for deterministic tests: 2024-03-15 UTC
const NOW = new Date('2024-03-15T12:00:00Z');

describe('resolveWindow', () => {
  it('--days 7: sinceISO is 7 days ago, daysInWindow = 7', () => {
    const w = resolveWindow({ days: 7 }, NOW);
    expect(w.daysInWindow).toBe(7);
    expect(w.sinceISO).toBe('2024-03-09'); // 2024-03-15 - 6 days = 2024-03-09
    expect(w.year).toBe(2024);
    expect(w.month).toBe(3);
  });

  it('--days 1: sinceISO is today, daysInWindow = 1', () => {
    const w = resolveWindow({ days: 1 }, NOW);
    expect(w.daysInWindow).toBe(1);
    expect(w.sinceISO).toBe('2024-03-15');
    expect(w.year).toBe(2024);
    expect(w.month).toBe(3);
  });

  it('--month/--year: sinceISO = YYYY-MM-01, daysInWindow = days in that month', () => {
    const w = resolveWindow({ month: 1, year: 2024 }, NOW);
    expect(w.sinceISO).toBe('2024-01-01');
    expect(w.year).toBe(2024);
    expect(w.month).toBe(1);
    expect(w.day).toBeUndefined();
    expect(w.daysInWindow).toBe(31);
  });

  it('Feb 2024 = 29 days (leap year)', () => {
    const w = resolveWindow({ month: 2, year: 2024 }, NOW);
    expect(w.sinceISO).toBe('2024-02-01');
    expect(w.daysInWindow).toBe(29);
  });

  it('Feb 2023 = 28 days (non-leap year)', () => {
    const w = resolveWindow({ month: 2, year: 2023 }, NOW);
    expect(w.sinceISO).toBe('2023-02-01');
    expect(w.daysInWindow).toBe(28);
  });

  it('default (no opts): same as --days 7', () => {
    const w = resolveWindow({}, NOW);
    const w7 = resolveWindow({ days: 7 }, NOW);
    expect(w).toEqual(w7);
  });

  it('month boundary crossing: --days 10 where today is Jan 5 → sinceISO is Dec 27', () => {
    const jan5 = new Date('2024-01-05T12:00:00Z');
    const w = resolveWindow({ days: 10 }, jan5);
    expect(w.sinceISO).toBe('2023-12-27'); // Jan 5 - 9 days = Dec 27
    expect(w.daysInWindow).toBe(10);
    expect(w.year).toBe(2024);
    expect(w.month).toBe(1);
  });
});

describe('daysInMonth', () => {
  it('Jan 2024 = 31', () => expect(daysInMonth(2024, 1)).toBe(31));
  it('Feb 2024 = 29 (leap)', () => expect(daysInMonth(2024, 2)).toBe(29));
  it('Feb 2023 = 28 (non-leap)', () => expect(daysInMonth(2023, 2)).toBe(28));
  it('Apr 2024 = 30', () => expect(daysInMonth(2024, 4)).toBe(30));
  it('Dec 2024 = 31', () => expect(daysInMonth(2024, 12)).toBe(31));
});
