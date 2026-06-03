import type { LineItem, AnnotatedRun, OsKey, RepoRollup, OsRollup, WorkflowRollup, JobRollup, ReconciliationInfo, RollupResult, Config } from './types.js';
import { billedMinutes, skuToOsKey, MULTIPLIER } from './multipliers.js';
import type { BillingResult } from '../github/billing.js';

// ---------------------------------------------------------------------------
// rollupByRepo
// ---------------------------------------------------------------------------

/**
 * Group billing line items by repositoryName, sum billed minutes per repo,
 * compute percentOfTotal, determine dominantOs.
 * Returns sorted descending by billedMinutes.
 */
export function rollupByRepo(items: LineItem[]): RepoRollup[] {
  // Map: repo -> { total, perOsMinutes: Map<OsKey, number> }
  const repoMap = new Map<string, { total: number; perOs: Map<OsKey | '__unknown__', number> }>();

  for (const item of items) {
    const repo = item.repositoryName ?? '';
    if (!repoMap.has(repo)) {
      repoMap.set(repo, { total: 0, perOs: new Map() });
    }
    const entry = repoMap.get(repo)!;
    entry.total += item.quantity;

    const osKey = skuToOsKey(item.sku);
    const key: OsKey | '__unknown__' = osKey ?? '__unknown__';
    entry.perOs.set(key, (entry.perOs.get(key) ?? 0) + item.quantity);
  }

  const totalAll = [...repoMap.values()].reduce((sum, e) => sum + e.total, 0);

  const rollups: RepoRollup[] = [];
  for (const [repo, { total, perOs }] of repoMap) {
    // Find dominant OS (highest billed minutes among recognized OS keys)
    let dominantOs: OsKey | null = null;
    let maxOsMinutes = -1;
    for (const [key, minutes] of perOs) {
      if (key !== '__unknown__' && minutes > maxOsMinutes) {
        maxOsMinutes = minutes;
        dominantOs = key as OsKey;
      }
    }

    rollups.push({
      repo,
      billedMinutes: total,
      percentOfTotal: totalAll > 0 ? (total / totalAll) * 100 : 0,
      dominantOs,
    });
  }

  rollups.sort((a, b) => b.billedMinutes - a.billedMinutes);
  return rollups;
}

// ---------------------------------------------------------------------------
// rollupByOs
// ---------------------------------------------------------------------------

/**
 * Group billing line items by SKU, map to OsKey, sum billed minutes.
 * Skips unrecognized SKUs.
 * Returns sorted descending by billedMinutes.
 */
export function rollupByOs(items: LineItem[]): OsRollup[] {
  // Map: OsKey -> { sku (most common seen), minutes }
  // Group by OsKey so "Actions Linux" and "Actions Linux 4-core" both merge into UBUNTU.
  const osMap = new Map<OsKey, { sku: string; skuCount: Map<string, number>; minutes: number }>();

  for (const item of items) {
    const osKey = skuToOsKey(item.sku);
    if (osKey === null) continue; // skip unrecognized SKUs

    if (!osMap.has(osKey)) {
      osMap.set(osKey, { sku: item.sku, skuCount: new Map(), minutes: 0 });
    }
    const entry = osMap.get(osKey)!;
    entry.minutes += item.quantity;
    entry.skuCount.set(item.sku, (entry.skuCount.get(item.sku) ?? 0) + 1);
    // Track the most frequently seen SKU as the label
    let maxCount = 0;
    let mostCommonSku = entry.sku;
    for (const [s, cnt] of entry.skuCount) {
      if (cnt > maxCount) { maxCount = cnt; mostCommonSku = s; }
    }
    entry.sku = mostCommonSku;
  }

  const rollups: OsRollup[] = [];
  for (const [os, { sku, minutes }] of osMap) {
    rollups.push({
      os,
      sku,
      billedMinutes: minutes,
      multiplier: MULTIPLIER[os],
    });
  }

  rollups.sort((a, b) => b.billedMinutes - a.billedMinutes);
  return rollups;
}

// ---------------------------------------------------------------------------
// computeTimingByRepo
// ---------------------------------------------------------------------------

/**
 * For each run, sum billedMinutes(os, totalMs) across all OS keys.
 * Group by repo.
 * Returns Map<repo, totalEstimatedBilledMinutes>.
 */
export function computeTimingByRepo(runs: AnnotatedRun[]): Map<string, number> {
  const repoMap = new Map<string, number>();

  for (const run of runs) {
    const runMinutes = estimatedMinutesForRun(run);
    repoMap.set(run.repo, (repoMap.get(run.repo) ?? 0) + runMinutes);
  }

  return repoMap;
}

/** Sum estimated billed minutes for a single run across all OS keys. */
function estimatedMinutesForRun(run: AnnotatedRun): number {
  let total = 0;
  for (const [os, timing] of Object.entries(run.timing.billable) as [OsKey, { totalMs: number }][]) {
    total += billedMinutes(os, timing.totalMs);
  }
  return total;
}

// ---------------------------------------------------------------------------
// reconciliationRatio
// ---------------------------------------------------------------------------

/**
 * Returns timingMin / billingMin.
 * If billingMin === 0, returns 1 to avoid division by zero.
 */
export function reconciliationRatio(billingMin: number, timingMin: number): number {
  if (billingMin === 0) return 1;
  return timingMin / billingMin;
}

// ---------------------------------------------------------------------------
// apportionByWorkflow
// ---------------------------------------------------------------------------

/**
 * Apportion repoBilledMinutes across workflows proportionally based on timing.
 * INVARIANT: sum of result[].billedMinutes === repoBilledMinutes (within floating point).
 * If total timing is 0, distributes evenly.
 * Returns sorted descending by billedMinutes.
 */
export function apportionByWorkflow(runs: AnnotatedRun[], repoBilledMinutes: number): WorkflowRollup[] {
  if (runs.length === 0) return [];

  // Compute each run's estimated minutes, group by workflow
  const wfMinutes = new Map<string, number>();
  const wfRepo = new Map<string, string>();

  for (const run of runs) {
    const mins = estimatedMinutesForRun(run);
    wfMinutes.set(run.workflowName, (wfMinutes.get(run.workflowName) ?? 0) + mins);
    wfRepo.set(run.workflowName, run.repo);
  }

  const workflowNames = [...wfMinutes.keys()];
  const totalTimingMinutes = [...wfMinutes.values()].reduce((s, v) => s + v, 0);

  const rollups: WorkflowRollup[] = workflowNames.map((name) => {
    const share = totalTimingMinutes > 0
      ? (wfMinutes.get(name)! / totalTimingMinutes) * repoBilledMinutes
      : repoBilledMinutes / workflowNames.length;

    return {
      repo: wfRepo.get(name)!,
      workflowName: name,
      billedMinutes: share,
    };
  });

  rollups.sort((a, b) => b.billedMinutes - a.billedMinutes);

  // Enforce invariant: adjust last element to absorb floating-point drift
  const sumExceptLast = rollups.slice(0, -1).reduce((s, r) => s + r.billedMinutes, 0);
  rollups[rollups.length - 1].billedMinutes = repoBilledMinutes - sumExceptLast;

  return rollups;
}

// ---------------------------------------------------------------------------
// apportionByJob
// ---------------------------------------------------------------------------

/**
 * Apportion workflowBilledMinutes across jobs proportionally based on billed minutes
 * (ceil(durationMs/60000)*MULTIPLIER[os]) so job weights are consistent with workflow weights.
 * Only includes jobs where jobNames is populated on the run.
 * Returns sorted descending by billedMinutes.
 */
export function apportionByJob(runs: AnnotatedRun[], workflowBilledMinutes: number): JobRollup[] {
  if (runs.length === 0) return [];

  // Collect job-level billed-minutes totals (OS-aware)
  interface JobEntry {
    repo: string;
    workflowName: string;
    jobName: string;
    totalBilledMinutes: number;
  }

  const jobMap = new Map<number, JobEntry>();

  for (const run of runs) {
    if (!run.jobNames) continue;

    for (const [os, timing] of Object.entries(run.timing.billable) as [OsKey, { jobRuns: { jobId: number; durationMs: number }[] }][]) {
      for (const jobRun of timing.jobRuns) {
        const jobName = run.jobNames.get(jobRun.jobId);
        if (jobName === undefined) continue;

        if (!jobMap.has(jobRun.jobId)) {
          jobMap.set(jobRun.jobId, {
            repo: run.repo,
            workflowName: run.workflowName,
            jobName,
            totalBilledMinutes: 0,
          });
        }
        jobMap.get(jobRun.jobId)!.totalBilledMinutes += billedMinutes(os as OsKey, jobRun.durationMs);
      }
    }
  }

  if (jobMap.size === 0) return [];

  const entries = [...jobMap.values()];
  const totalWeight = entries.reduce((s, e) => s + e.totalBilledMinutes, 0);

  const rollups: JobRollup[] = entries.map((e) => ({
    repo: e.repo,
    workflowName: e.workflowName,
    jobName: e.jobName,
    billedMinutes: totalWeight > 0
      ? (e.totalBilledMinutes / totalWeight) * workflowBilledMinutes
      : workflowBilledMinutes / entries.length,
  }));

  rollups.sort((a, b) => b.billedMinutes - a.billedMinutes);

  // Enforce invariant
  const sumExceptLast = rollups.slice(0, -1).reduce((s, r) => s + r.billedMinutes, 0);
  rollups[rollups.length - 1].billedMinutes = workflowBilledMinutes - sumExceptLast;

  return rollups;
}

// ---------------------------------------------------------------------------
// buildRollupResult
// ---------------------------------------------------------------------------

/**
 * Orchestrate all aggregation.
 * - Billing is authority for minutes when available.
 * - Timing is used to apportion billing minutes across workflows/jobs.
 * - When billing not available, timing-estimated mode.
 */
export function buildRollupResult(params: {
  billing: BillingResult;
  runs: AnnotatedRun[];
  config: Config;
}): RollupResult {
  const { billing, runs, config } = params;

  let byRepo: RepoRollup[];
  let byOs: OsRollup[];
  let source: RollupResult['source'];
  let totalBilledMinutes: number;

  if (billing.available && billing.items.length > 0) {
    // Fix 1: compute totalBilledMinutes from the FULL unsliced set before applying top limit
    const unslicedByRepo = rollupByRepo(billing.items);
    totalBilledMinutes = billing.items.reduce((sum, item) => sum + item.quantity, 0);
    byRepo = unslicedByRepo.slice(0, config.top);
    byOs = rollupByOs(billing.items);
    source = 'billing';
  } else if (billing.available && billing.items.length === 0 && runs.length > 0) {
    // Billing available but empty — fall through to timing
    const timingMap = computeTimingByRepo(runs);
    byRepo = buildRepoRollupsFromTiming(timingMap, config.top);
    totalBilledMinutes = byRepo.reduce((s, r) => s + r.billedMinutes, 0);
    byOs = [];
    source = 'timing-estimated';
  } else if (!billing.available) {
    const timingMap = computeTimingByRepo(runs);
    byRepo = buildRepoRollupsFromTiming(timingMap, config.top);
    totalBilledMinutes = byRepo.reduce((s, r) => s + r.billedMinutes, 0);
    byOs = [];
    source = 'timing-estimated';
  } else {
    // billing.available=true, items=[], runs=[]
    byRepo = [];
    byOs = [];
    totalBilledMinutes = 0;
    source = 'billing';
  }

  // Fix 6: compute timingByRepo once and reuse for reconciliation
  const timingByRepo = computeTimingByRepo(runs);

  // Build workflow/job rollups per repo
  const byWorkflow: WorkflowRollup[] = [];
  const byJob: JobRollup[] = [];
  const reconciliation: ReconciliationInfo[] = [];

  const wantWorkflow = config.by.has('workflow') || config.by.has('job');
  const wantJob = config.by.has('job');

  for (const repoRollup of byRepo) {
    const repoRuns = runs.filter((r) => r.repo === repoRollup.repo);
    const repoBilledMinutes = repoRollup.billedMinutes;

    if (repoRuns.length > 0) {
      if (wantWorkflow) {
        const wfRollups = apportionByWorkflow(repoRuns, repoBilledMinutes);
        byWorkflow.push(...wfRollups);

        if (wantJob) {
          // Apportion jobs per-workflow so each workflow's jobs sum to that workflow's allocation
          for (const wf of wfRollups) {
            const wfRuns = repoRuns.filter((r) => r.workflowName === wf.workflowName);
            const wfJobs = apportionByJob(wfRuns, wf.billedMinutes);
            byJob.push(...wfJobs);
          }
        }
      }

      if (billing.available) {
        const timingMin = timingByRepo.get(repoRollup.repo) ?? 0;
        reconciliation.push({
          repo: repoRollup.repo,
          billingMinutes: repoBilledMinutes,
          timingMinutes: timingMin,
          ratio: reconciliationRatio(repoBilledMinutes, timingMin),
        });
      }
    }
  }

  return {
    org: config.org,
    window: config.window,
    billingAvailable: billing.available,
    totalBilledMinutes,
    byRepo,
    byOs,
    byWorkflow,
    byJob,
    reconciliation,
    source,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRepoRollupsFromTiming(timingMap: Map<string, number>, top: number): RepoRollup[] {
  const total = [...timingMap.values()].reduce((s, v) => s + v, 0);

  const rollups: RepoRollup[] = [];
  for (const [repo, minutes] of timingMap) {
    rollups.push({
      repo,
      billedMinutes: minutes,
      percentOfTotal: total > 0 ? (minutes / total) * 100 : 0,
      dominantOs: null, // timing doesn't tell us the dominant OS definitively
    });
  }

  rollups.sort((a, b) => b.billedMinutes - a.billedMinutes);
  return rollups.slice(0, top);
}
