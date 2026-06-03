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
  reconciliation: ReconciliationInfo[];
  source: 'billing' | 'timing-estimated' | 'mixed';
}

export interface TimeWindow {
  year: number;
  month: number;           // 1-12
  day?: number;
  sinceISO: string;        // ISO date string YYYY-MM-DD
  daysInWindow: number;    // number of calendar days in the window
}

export interface Config {
  org: string;
  token: string;
  window: TimeWindow;
  by: Set<'repo' | 'workflow' | 'job' | 'os'>;
  top: number;
  source: 'billing' | 'timing' | 'auto';
  noTiming: boolean;
  concurrency: number;
  outputFormat: 'table' | 'json' | 'csv';
}
