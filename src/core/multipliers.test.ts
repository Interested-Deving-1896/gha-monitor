import { describe, it, expect } from 'vitest';
import { billedMinutes, skuToOsKey } from './multipliers.js';

describe('billedMinutes', () => {
  it('UBUNTU 0ms → 0 min', () => {
    expect(billedMinutes('UBUNTU', 0)).toBe(0);
  });

  it('UBUNTU 60000ms → 1 min', () => {
    expect(billedMinutes('UBUNTU', 60000)).toBe(1);
  });

  it('UBUNTU 61000ms → 2 min (ceil)', () => {
    expect(billedMinutes('UBUNTU', 61000)).toBe(2);
  });

  it('MACOS 60000ms → 10 min (multiplier x10)', () => {
    expect(billedMinutes('MACOS', 60000)).toBe(10);
  });

  it('WINDOWS 61000ms → 4 min (ceil=2, *2=4)', () => {
    expect(billedMinutes('WINDOWS', 61000)).toBe(4);
  });
});

describe('skuToOsKey', () => {
  it('"Actions Linux" → UBUNTU', () => {
    expect(skuToOsKey('Actions Linux')).toBe('UBUNTU');
  });

  it('"Actions macOS" → MACOS', () => {
    expect(skuToOsKey('Actions macOS')).toBe('MACOS');
  });

  it('"Actions Windows" → WINDOWS', () => {
    expect(skuToOsKey('Actions Windows')).toBe('WINDOWS');
  });

  it('"Actions Linux 4-core" → UBUNTU (contains Linux)', () => {
    expect(skuToOsKey('Actions Linux 4-core')).toBe('UBUNTU');
  });

  it('unknown SKU → null', () => {
    expect(skuToOsKey('Actions Unknown')).toBeNull();
  });

  it('empty string → null', () => {
    expect(skuToOsKey('')).toBeNull();
  });
});
