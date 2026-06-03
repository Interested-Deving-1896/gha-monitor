import type { RollupResult } from '../core/types.js';

function mapReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) {
    return Object.fromEntries(value);
  }
  return value;
}

export function renderJson(result: RollupResult): string {
  return JSON.stringify(result, mapReplacer, 2);
}
