import { describe, it, expect } from 'vitest';
import { formatDuration } from './table.js';

describe('formatDuration', () => {
  it('formats 0ms as "0m 00s"', () => {
    expect(formatDuration(0)).toBe('0m 00s');
  });

  it('formats less than 1 minute correctly (0m Xs)', () => {
    expect(formatDuration(41_000)).toBe('0m 41s');
  });

  it('formats exactly 1 minute as "1m 00s"', () => {
    expect(formatDuration(60_000)).toBe('1m 00s');
  });

  it('formats 2m 34s correctly', () => {
    expect(formatDuration(154_000)).toBe('2m 34s');
  });

  it('formats 8m 02s correctly (zero-pads seconds)', () => {
    expect(formatDuration(482_000)).toBe('8m 02s');
  });

  it('formats large values (> 60 min)', () => {
    // 90 min + 5s = 5_405_000 ms
    expect(formatDuration(5_405_000)).toBe('90m 05s');
  });

  it('truncates sub-second precision (floors to seconds)', () => {
    // 90_500ms → 1m 30s (floors, not rounds)
    expect(formatDuration(90_500)).toBe('1m 30s');
  });
});
