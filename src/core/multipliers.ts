import type { OsKey } from './types.js';

export const MULTIPLIER: Record<OsKey, number> = {
  UBUNTU: 1,
  WINDOWS: 2,
  MACOS: 10,
};

/**
 * Compute billed minutes for a single run on a given OS.
 * GitHub bills each run rounded up to the nearest minute, then multiplies.
 * Formula: ceil(totalMs / 60000) * MULTIPLIER[os]
 */
export function billedMinutes(os: OsKey, totalMs: number): number {
  return Math.ceil(totalMs / 60_000) * MULTIPLIER[os];
}

/**
 * Map a billing SKU string to an OsKey.
 * Examples: "Actions Linux" -> UBUNTU, "Actions macOS" -> MACOS, "Actions Windows" -> WINDOWS
 * Returns null if SKU is not a recognized Actions runner OS.
 */
export function skuToOsKey(sku: string): OsKey | null {
  if (sku.includes('Linux')) return 'UBUNTU';
  if (sku.includes('macOS')) return 'MACOS';
  if (sku.includes('Windows')) return 'WINDOWS';
  return null;
}
