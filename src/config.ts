import type { Config } from './core/types.js';
import { resolveWindow } from './core/window.js';

export interface CliOpts {
  org?: string;
  days?: number;
  month?: number;
  year?: number;
  by?: string;        // comma-separated: "repo,os,workflow,job"
  top?: number;
  source?: string;
  noTiming?: boolean;
  concurrency?: number;
  json?: boolean;
  csv?: boolean;
  token?: string;
}

const VALID_GROUP_BY = new Set(['repo', 'workflow', 'job', 'os'] as const);
type GroupByValue = 'repo' | 'workflow' | 'job' | 'os';

const VALID_SOURCES = new Set(['billing', 'timing', 'auto'] as const);
type SourceValue = 'billing' | 'timing' | 'auto';

/**
 * Resolve and validate all CLI options into a Config object.
 *
 * Throws a descriptive Error for any missing or conflicting options.
 */
export function resolveConfig(opts: CliOpts): Config {
  // 1. Resolve token
  const token =
    opts.token ??
    process.env['GH_TOKEN'] ??
    process.env['GITHUB_TOKEN'];

  if (!token) {
    throw new Error(
      'No GitHub token found. Set GH_TOKEN or GITHUB_TOKEN environment variable.',
    );
  }

  // 2. Validate org
  if (!opts.org) {
    throw new Error('--org is required.');
  }
  const org = opts.org;

  // 3. Validate --days and --month/--year are mutually exclusive
  const hasDays = opts.days !== undefined;
  const hasMonth = opts.month !== undefined || opts.year !== undefined;

  if (hasDays && hasMonth) {
    throw new Error('--days and --month/--year are mutually exclusive.');
  }

  // 4. Validate --source
  const rawSource = opts.source ?? 'auto';
  if (!VALID_SOURCES.has(rawSource as SourceValue)) {
    throw new Error(
      `--source must be one of: ${[...VALID_SOURCES].join(', ')}. Got: "${rawSource}".`,
    );
  }
  const source = rawSource as SourceValue;

  // 5. Parse --by
  let groupBy: Set<GroupByValue>;
  if (opts.by) {
    const parts = opts.by.split(',').map((s) => s.trim()).filter(Boolean);
    const invalid = parts.filter((p) => !VALID_GROUP_BY.has(p as GroupByValue));
    if (invalid.length > 0) {
      throw new Error(
        `Invalid --by value(s): ${invalid.join(', ')}. Valid values are: ${[...VALID_GROUP_BY].join(', ')}.`,
      );
    }
    groupBy = new Set(parts as GroupByValue[]);
  } else {
    groupBy = new Set<GroupByValue>(['repo', 'os']);
  }

  // 6. Validate outputFormat — --json and --csv are mutually exclusive
  if (opts.json && opts.csv) {
    throw new Error('--json and --csv are mutually exclusive.');
  }
  const outputFormat: 'table' | 'json' | 'csv' = opts.json
    ? 'json'
    : opts.csv
      ? 'csv'
      : 'table';

  // 7. Resolve the time window
  const window = resolveWindow({
    days: opts.days,
    month: opts.month,
    year: opts.year,
  });

  // 8. Return Config
  return {
    token,
    org,
    window,
    by: groupBy,
    top: opts.top ?? 10,
    source,
    noTiming: opts.noTiming ?? false,
    concurrency: opts.concurrency ?? 8,
    outputFormat,
  };
}
