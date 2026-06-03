export type OsKey = 'UBUNTU' | 'MACOS' | 'WINDOWS';

export interface LineItem {
  date: string;           // ISO date string
  product: string;        // e.g. "Actions"
  sku: string;            // e.g. "Actions Linux", "Actions macOS"
  quantity: number;       // already-billed minutes (multipliers applied by GitHub)
  unitType: string;       // e.g. "minutes"
  pricePerUnit: number;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  repositoryName?: string;
  organizationName?: string;
}

export interface JobRun {
  jobId: number;
  durationMs: number;
}

export interface OsTiming {
  totalMs: number;
  jobs: number;
  jobRuns: JobRun[];
}

export interface RunTiming {
  runId: number;
  billable: Partial<Record<OsKey, OsTiming>>;
  /** Wall-clock duration in ms from run_duration_ms. Used as fallback when
   *  billable.*.totalMs is zero (GitHub deprecated the per-OS machine-time fields). */
  runDurationMs?: number;
}

export interface AnnotatedRun {
  repo: string;           // full_name e.g. "myorg/myrepo"
  workflowName: string;
  runId: number;
  timing: RunTiming;
  jobNames?: Map<number, string>; // jobId -> name, only populated when --by job
}

export interface RepoRollup {
  repo: string;
  billedMinutes: number;
  percentOfTotal: number;
  dominantOs: OsKey | null;
}

export interface OsRollup {
  os: OsKey;
  sku: string;
  billedMinutes: number;    // from billing line items
  multiplier: number;
}

export interface WorkflowRollup {
  repo: string;
  workflowName: string;
  billedMinutes: number;
}

export interface JobRollup {
  repo: string;
  workflowName: string;
  jobName: string;
  billedMinutes: number;
}

export interface RunRollup {
  repo: string;
  workflowName: string;
  runId: number;
  /** Effective total ms (wall-clock run duration when billing totals are zero). */
  rawMs: number;
  /** Estimated billed minutes: ceil(ms/60000)*MULTIPLIER per OS, summed. */
  billedMinutes: number;
  dominantOs: OsKey | null;
}

export interface ReconciliationInfo {
  repo: string;
  billingMinutes: number;
  timingMinutes: number;
  ratio: number;
}

export interface RollupResult {
  org: string;
  window: TimeWindow;
  billingAvailable: boolean;
  totalBilledMinutes: number;
  byRepo: RepoRollup[];
  byOs: OsRollup[];
  byWorkflow: WorkflowRollup[];
  byJob: JobRollup[];
  byRun: RunRollup[];
  reconciliation: ReconciliationInfo[];
  source: 'billing' | 'timing-estimated' | 'mixed';
}

export interface TimeWindow {
  year: number;
  month: number;           // 1-12
  day?: number;
  sinceISO: string;        // ISO date string YYYY-MM-DD
  untilISO?: string;       // ISO date string YYYY-MM-DD (inclusive upper bound)
  daysInWindow: number;    // number of calendar days in the window
}

export type GroupByValue = 'repo' | 'workflow' | 'job' | 'os' | 'run';
export type SourceValue = 'billing' | 'timing' | 'auto';
export type OutputFormat = 'table' | 'json' | 'csv';

export interface Config {
  org: string;
  token: string;
  window: TimeWindow;
  by: Set<GroupByValue>;
  top: number;
  source: SourceValue;
  noTiming: boolean;
  concurrency: number;
  outputFormat: OutputFormat;
}
