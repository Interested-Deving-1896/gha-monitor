import { describe, it, expect, beforeEach } from 'vitest';
import type { LineItem, AnnotatedRun, RunTiming } from './types.js';
import {
  rollupByRepo,
  rollupByOs,
  computeTimingByRepo,
  reconciliationRatio,
  apportionByWorkflow,
  apportionByJob,
  buildRollupResult,
  buildByRun,
  effectiveOsMs,
  estimatedMinutesForRun,
} from './aggregate.js';
import type { BillingResult } from '../github/billing.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeLineItem(overrides: Partial<LineItem>): LineItem {
  return {
    date: '2024-01-15',
    product: 'Actions',
    sku: 'Actions Linux',
    quantity: 10,
    unitType: 'minutes',
    pricePerUnit: 0.008,
    grossAmount: 0.08,
    discountAmount: 0,
    netAmount: 0.08,
    repositoryName: 'myorg/myrepo',
    organizationName: 'myorg',
    ...overrides,
  };
}

// Fix 4: deterministic run ID counter instead of Math.random()
let _nextRunId = 1;
beforeEach(() => { _nextRunId = 1; });

function makeRunTiming(billable: RunTiming['billable']): RunTiming {
  return { runId: _nextRunId++, billable };
}

function makeAnnotatedRun(overrides: Partial<AnnotatedRun> & { timing: RunTiming }): AnnotatedRun {
  return {
    repo: 'myorg/myrepo',
    workflowName: 'CI',
    runId: overrides.timing.runId,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// rollupByRepo
// ---------------------------------------------------------------------------

describe('rollupByRepo', () => {
  it('groups items by repo, sums billed minutes, sorts descending', () => {
    const items: LineItem[] = [
      makeLineItem({ repositoryName: 'myorg/repoA', sku: 'Actions Linux', quantity: 30 }),
      makeLineItem({ repositoryName: 'myorg/repoA', sku: 'Actions macOS', quantity: 20 }),
      makeLineItem({ repositoryName: 'myorg/repoB', sku: 'Actions Linux', quantity: 100 }),
    ];

    const result = rollupByRepo(items);

    expect(result).toHaveLength(2);
    expect(result[0].repo).toBe('myorg/repoB');
    expect(result[0].billedMinutes).toBe(100);
    expect(result[1].repo).toBe('myorg/repoA');
    expect(result[1].billedMinutes).toBe(50);
  });

  it('computes percentOfTotal correctly', () => {
    const items: LineItem[] = [
      makeLineItem({ repositoryName: 'myorg/repoA', quantity: 75 }),
      makeLineItem({ repositoryName: 'myorg/repoB', quantity: 25 }),
    ];

    const result = rollupByRepo(items);

    expect(result[0].percentOfTotal).toBeCloseTo(75, 5);
    expect(result[1].percentOfTotal).toBeCloseTo(25, 5);
  });

  it('determines dominantOs as the OS with most billed minutes for that repo', () => {
    const items: LineItem[] = [
      makeLineItem({ repositoryName: 'myorg/repoA', sku: 'Actions Linux', quantity: 30 }),
      makeLineItem({ repositoryName: 'myorg/repoA', sku: 'Actions macOS', quantity: 200 }),
    ];

    const result = rollupByRepo(items);

    expect(result[0].repo).toBe('myorg/repoA');
    expect(result[0].dominantOs).toBe('MACOS');
  });

  it('sets dominantOs to null for unrecognized SKU', () => {
    const items: LineItem[] = [
      makeLineItem({ repositoryName: 'myorg/repoA', sku: 'Actions Storage', quantity: 5 }),
    ];

    const result = rollupByRepo(items);

    expect(result[0].dominantOs).toBeNull();
  });

  it('returns empty array for empty input', () => {
    expect(rollupByRepo([])).toEqual([]);
  });

  it('handles items without repositoryName by grouping under empty string', () => {
    const items: LineItem[] = [
      makeLineItem({ repositoryName: undefined, sku: 'Actions Linux', quantity: 5 }),
    ];

    const result = rollupByRepo(items);
    expect(result).toHaveLength(1);
    expect(result[0].billedMinutes).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// rollupByOs
// ---------------------------------------------------------------------------

describe('rollupByOs', () => {
  it('groups by SKU, maps to OsKey, sums billed minutes, sorts descending', () => {
    const items: LineItem[] = [
      makeLineItem({ sku: 'Actions Linux', quantity: 100 }),
      makeLineItem({ sku: 'Actions Linux', quantity: 50 }),
      makeLineItem({ sku: 'Actions macOS', quantity: 200 }),
    ];

    const result = rollupByOs(items);

    expect(result).toHaveLength(2);
    expect(result[0].os).toBe('MACOS');
    expect(result[0].billedMinutes).toBe(200);
    expect(result[0].multiplier).toBe(10);
    expect(result[1].os).toBe('UBUNTU');
    expect(result[1].billedMinutes).toBe(150);
    expect(result[1].multiplier).toBe(1);
  });

  it('includes the sku string on the result', () => {
    const items: LineItem[] = [
      makeLineItem({ sku: 'Actions Windows', quantity: 40 }),
    ];

    const result = rollupByOs(items);

    expect(result[0].sku).toBe('Actions Windows');
    expect(result[0].os).toBe('WINDOWS');
    expect(result[0].multiplier).toBe(2);
  });

  it('skips unrecognized SKUs (no matching OsKey)', () => {
    const items: LineItem[] = [
      makeLineItem({ sku: 'Actions Linux', quantity: 10 }),
      makeLineItem({ sku: 'Actions Storage', quantity: 99 }),
    ];

    const result = rollupByOs(items);

    expect(result).toHaveLength(1);
    expect(result[0].os).toBe('UBUNTU');
  });

  it('returns empty array for empty input', () => {
    expect(rollupByOs([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// computeTimingByRepo
// ---------------------------------------------------------------------------

describe('computeTimingByRepo', () => {
  it('sums estimated billed minutes per repo across all runs and OS keys', () => {
    // Run 1: UBUNTU 60s = 1 min, MACOS 60s = 10 min → 11 min
    const t1 = makeRunTiming({
      UBUNTU: { totalMs: 60_000, jobs: 1, jobRuns: [] },
      MACOS: { totalMs: 60_000, jobs: 1, jobRuns: [] },
    });
    // Run 2: UBUNTU 120s = 2 min
    const t2 = makeRunTiming({
      UBUNTU: { totalMs: 120_000, jobs: 1, jobRuns: [] },
    });

    const runs: AnnotatedRun[] = [
      makeAnnotatedRun({ repo: 'myorg/repoA', workflowName: 'CI', timing: t1 }),
      makeAnnotatedRun({ repo: 'myorg/repoA', workflowName: 'CI', timing: t2 }),
    ];

    const result = computeTimingByRepo(runs);

    // repo A: (1 + 10) + 2 = 13
    expect(result.get('myorg/repoA')).toBe(13);
  });

  it('groups different repos separately', () => {
    const t1 = makeRunTiming({ UBUNTU: { totalMs: 60_000, jobs: 1, jobRuns: [] } });
    const t2 = makeRunTiming({ UBUNTU: { totalMs: 180_000, jobs: 1, jobRuns: [] } });

    const runs: AnnotatedRun[] = [
      makeAnnotatedRun({ repo: 'myorg/repoA', workflowName: 'CI', timing: t1 }),
      makeAnnotatedRun({ repo: 'myorg/repoB', workflowName: 'Deploy', timing: t2 }),
    ];

    const result = computeTimingByRepo(runs);

    expect(result.get('myorg/repoA')).toBe(1);
    expect(result.get('myorg/repoB')).toBe(3);
  });

  it('returns empty map for empty runs', () => {
    expect(computeTimingByRepo([])).toEqual(new Map());
  });
});

// ---------------------------------------------------------------------------
// reconciliationRatio
// ---------------------------------------------------------------------------

describe('reconciliationRatio', () => {
  it('returns timingMin / billingMin', () => {
    expect(reconciliationRatio(100, 95)).toBeCloseTo(0.95, 5);
  });

  it('returns 1 when billingMin is 0 (avoid division by zero)', () => {
    expect(reconciliationRatio(0, 50)).toBe(1);
  });

  it('returns 1 when both are 0', () => {
    expect(reconciliationRatio(0, 0)).toBe(1);
  });

  it('returns ratio > 1 when timing exceeds billing', () => {
    expect(reconciliationRatio(100, 110)).toBeCloseTo(1.1, 5);
  });
});

// ---------------------------------------------------------------------------
// apportionByWorkflow
// ---------------------------------------------------------------------------

describe('apportionByWorkflow', () => {
  it('apportions minutes proportionally across workflows', () => {
    // Workflow A: 60s UBUNTU = 1 min
    // Workflow B: 120s UBUNTU = 2 min
    // total timing = 3 min; repoBilledMinutes = 90
    // A share = 1/3 * 90 = 30; B share = 2/3 * 90 = 60
    const t1 = makeRunTiming({ UBUNTU: { totalMs: 60_000, jobs: 1, jobRuns: [] } });
    const t2 = makeRunTiming({ UBUNTU: { totalMs: 120_000, jobs: 1, jobRuns: [] } });

    const runs: AnnotatedRun[] = [
      makeAnnotatedRun({ repo: 'myorg/repo', workflowName: 'WorkflowA', timing: t1 }),
      makeAnnotatedRun({ repo: 'myorg/repo', workflowName: 'WorkflowB', timing: t2 }),
    ];

    const result = apportionByWorkflow(runs, 90);

    expect(result).toHaveLength(2);
    // Sort descending by billedMinutes
    expect(result[0].workflowName).toBe('WorkflowB');
    expect(result[0].billedMinutes).toBeCloseTo(60, 5);
    expect(result[1].workflowName).toBe('WorkflowA');
    expect(result[1].billedMinutes).toBeCloseTo(30, 5);
  });

  it('ensures sum of apportioned minutes equals repoBilledMinutes exactly (invariant)', () => {
    // Use fractional splits that would drift with floating point
    const t1 = makeRunTiming({ UBUNTU: { totalMs: 100_000, jobs: 1, jobRuns: [] } });
    const t2 = makeRunTiming({ UBUNTU: { totalMs: 100_000, jobs: 1, jobRuns: [] } });
    const t3 = makeRunTiming({ UBUNTU: { totalMs: 100_000, jobs: 1, jobRuns: [] } });

    const runs: AnnotatedRun[] = [
      makeAnnotatedRun({ repo: 'myorg/repo', workflowName: 'WF1', timing: t1 }),
      makeAnnotatedRun({ repo: 'myorg/repo', workflowName: 'WF2', timing: t2 }),
      makeAnnotatedRun({ repo: 'myorg/repo', workflowName: 'WF3', timing: t3 }),
    ];

    const repoBilledMinutes = 100;
    const result = apportionByWorkflow(runs, repoBilledMinutes);

    const total = result.reduce((acc, r) => acc + r.billedMinutes, 0);
    expect(total).toBeCloseTo(repoBilledMinutes, 2);
  });

  it('distributes evenly when total timing minutes is 0', () => {
    const t1 = makeRunTiming({});
    const t2 = makeRunTiming({});

    const runs: AnnotatedRun[] = [
      makeAnnotatedRun({ repo: 'myorg/repo', workflowName: 'WF1', timing: t1 }),
      makeAnnotatedRun({ repo: 'myorg/repo', workflowName: 'WF2', timing: t2 }),
    ];

    const result = apportionByWorkflow(runs, 20);

    expect(result).toHaveLength(2);
    const total = result.reduce((acc, r) => acc + r.billedMinutes, 0);
    expect(total).toBeCloseTo(20, 5);
    // Each should be 10
    for (const wf of result) {
      expect(wf.billedMinutes).toBeCloseTo(10, 5);
    }
  });

  it('groups multiple runs with same workflow name', () => {
    const t1 = makeRunTiming({ UBUNTU: { totalMs: 60_000, jobs: 1, jobRuns: [] } });
    const t2 = makeRunTiming({ UBUNTU: { totalMs: 60_000, jobs: 1, jobRuns: [] } });
    const t3 = makeRunTiming({ UBUNTU: { totalMs: 60_000, jobs: 1, jobRuns: [] } });

    const runs: AnnotatedRun[] = [
      makeAnnotatedRun({ repo: 'myorg/repo', workflowName: 'CI', timing: t1 }),
      makeAnnotatedRun({ repo: 'myorg/repo', workflowName: 'CI', timing: t2 }),
      makeAnnotatedRun({ repo: 'myorg/repo', workflowName: 'Deploy', timing: t3 }),
    ];

    const result = apportionByWorkflow(runs, 90);

    expect(result).toHaveLength(2);
    const ci = result.find((r) => r.workflowName === 'CI')!;
    const deploy = result.find((r) => r.workflowName === 'Deploy')!;
    expect(ci.billedMinutes).toBeCloseTo(60, 5);
    expect(deploy.billedMinutes).toBeCloseTo(30, 5);
  });

  it('returns empty array for empty runs', () => {
    expect(apportionByWorkflow([], 100)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// apportionByJob
// ---------------------------------------------------------------------------

describe('apportionByJob', () => {
  it('apportions minutes by job using jobNames map', () => {
    // Job 1 (id=1): 60s UBUNTU = 1 min
    // Job 2 (id=2): 60s UBUNTU = 1 min
    const timing: RunTiming = {
      runId: 999,
      billable: {
        UBUNTU: {
          totalMs: 120_000,
          jobs: 2,
          jobRuns: [
            { jobId: 1, durationMs: 60_000 },
            { jobId: 2, durationMs: 60_000 },
          ],
        },
      },
    };

    const run: AnnotatedRun = {
      repo: 'myorg/repo',
      workflowName: 'CI',
      runId: 999,
      timing,
      jobNames: new Map([[1, 'build'], [2, 'test']]),
    };

    const result = apportionByJob([run], 100);

    expect(result).toHaveLength(2);
    const total = result.reduce((acc, r) => acc + r.billedMinutes, 0);
    expect(total).toBeCloseTo(100, 2);
    // Each job: 60s / 120s total = 50%
    for (const job of result) {
      expect(job.billedMinutes).toBeCloseTo(50, 2);
    }
  });

  it('skips runs without jobNames', () => {
    const t = makeRunTiming({ UBUNTU: { totalMs: 60_000, jobs: 1, jobRuns: [{ jobId: 1, durationMs: 60_000 }] } });
    const run: AnnotatedRun = {
      repo: 'myorg/repo',
      workflowName: 'CI',
      runId: t.runId,
      timing: t,
      // no jobNames
    };

    const result = apportionByJob([run], 100);
    expect(result).toEqual([]);
  });

  it('returns empty array for empty runs', () => {
    expect(apportionByJob([], 100)).toEqual([]);
  });

  // Fix 5: invariant test with 3 unequal jobs to exercise FP drift adjustment
  it('sum of billedMinutes equals workflowBilledMinutes exactly (invariant, 3 unequal jobs)', () => {
    // Job 1: 60s UBUNTU → 1 billed min
    // Job 2: 120s UBUNTU → 2 billed min
    // Job 3: 90s UBUNTU → 2 billed min (ceil(1.5) = 2)
    // Weights: 1, 2, 2 → total weight 5; with workflowBilledMinutes=100:
    //   job1 = 20, job2 = 40, job3 = 40
    const timing: RunTiming = {
      runId: 1,
      billable: {
        UBUNTU: {
          totalMs: 270_000,
          jobs: 3,
          jobRuns: [
            { jobId: 1, durationMs: 60_000 },
            { jobId: 2, durationMs: 120_000 },
            { jobId: 3, durationMs: 90_000 },
          ],
        },
      },
    };

    const run: AnnotatedRun = {
      repo: 'myorg/repo',
      workflowName: 'CI',
      runId: 1,
      timing,
      jobNames: new Map([[1, 'lint'], [2, 'build'], [3, 'test']]),
    };

    const workflowBilledMinutes = 100;
    const result = apportionByJob([run], workflowBilledMinutes);

    expect(result).toHaveLength(3);
    const total = result.reduce((acc, r) => acc + r.billedMinutes, 0);
    expect(Math.abs(total - workflowBilledMinutes)).toBeLessThan(0.01);
  });
});

// ---------------------------------------------------------------------------
// buildRollupResult
// ---------------------------------------------------------------------------

describe('buildRollupResult', () => {
  const baseConfig = {
    org: 'myorg',
    token: 'tok',
    window: {
      year: 2024,
      month: 1,
      sinceISO: '2024-01-01',
      daysInWindow: 31,
    },
    by: new Set(['repo', 'workflow'] as const),
    top: 10,
    source: 'auto' as const,
    noTiming: false,
    concurrency: 5,
    outputFormat: 'table' as const,
  };

  it('uses billing as authority when billingAvailable=true', () => {
    const billing: BillingResult = {
      available: true,
      items: [
        makeLineItem({ repositoryName: 'myorg/repoA', sku: 'Actions Linux', quantity: 100 }),
        makeLineItem({ repositoryName: 'myorg/repoB', sku: 'Actions Linux', quantity: 50 }),
      ],
    };

    const t1 = makeRunTiming({ UBUNTU: { totalMs: 60_000, jobs: 1, jobRuns: [] } });
    const runs: AnnotatedRun[] = [
      makeAnnotatedRun({ repo: 'myorg/repoA', workflowName: 'CI', timing: t1 }),
    ];

    const result = buildRollupResult({ billing, runs, config: baseConfig });

    expect(result.billingAvailable).toBe(true);
    expect(result.source).toBe('billing');
    expect(result.totalBilledMinutes).toBe(150);
    expect(result.byRepo).toHaveLength(2);
    expect(result.byRepo[0].billedMinutes).toBe(100);
    expect(result.byOs).toHaveLength(1);
    expect(result.byOs[0].os).toBe('UBUNTU');
    // repoA has runs → byWorkflow populated
    expect(result.byWorkflow.length).toBeGreaterThan(0);
    expect(result.byWorkflow[0].workflowName).toBe('CI');
    // billing is authority so billedMinutes should equal what billing says for repoA
    expect(result.byWorkflow[0].billedMinutes).toBeCloseTo(100, 2);
  });

  it('uses timing-estimated mode when billingAvailable=false', () => {
    const billing: BillingResult = { available: false, items: [] };

    const t1 = makeRunTiming({ UBUNTU: { totalMs: 60_000, jobs: 1, jobRuns: [] } });
    const t2 = makeRunTiming({ UBUNTU: { totalMs: 120_000, jobs: 1, jobRuns: [] } });

    const runs: AnnotatedRun[] = [
      makeAnnotatedRun({ repo: 'myorg/repoA', workflowName: 'CI', timing: t1 }),
      makeAnnotatedRun({ repo: 'myorg/repoA', workflowName: 'Deploy', timing: t2 }),
    ];

    const result = buildRollupResult({ billing, runs, config: baseConfig });

    expect(result.billingAvailable).toBe(false);
    expect(result.source).toBe('timing-estimated');
    // byRepo derived from timing: 1 + 2 = 3 min
    expect(result.byRepo).toHaveLength(1);
    expect(result.byRepo[0].repo).toBe('myorg/repoA');
    expect(result.byRepo[0].billedMinutes).toBe(3);
    expect(result.totalBilledMinutes).toBe(3);
    expect(result.byOs).toEqual([]);
  });

  it('sets org and window from config', () => {
    const billing: BillingResult = { available: false, items: [] };
    const result = buildRollupResult({ billing, runs: [], config: baseConfig });

    expect(result.org).toBe('myorg');
    expect(result.window).toBe(baseConfig.window);
  });

  it('respects config.top limit on byRepo', () => {
    const items: LineItem[] = Array.from({ length: 5 }, (_, i) =>
      makeLineItem({ repositoryName: `myorg/repo${i}`, quantity: (i + 1) * 10 }),
    );

    const billing: BillingResult = { available: true, items };
    const config = { ...baseConfig, top: 3 };

    const result = buildRollupResult({ billing, runs: [], config });

    expect(result.byRepo.length).toBeLessThanOrEqual(3);
  });

  it('populates reconciliation info when billing is available and runs exist', () => {
    const billing: BillingResult = {
      available: true,
      items: [
        makeLineItem({ repositoryName: 'myorg/repoA', sku: 'Actions Linux', quantity: 100 }),
      ],
    };

    const t1 = makeRunTiming({ UBUNTU: { totalMs: 60_000, jobs: 1, jobRuns: [] } });
    const runs: AnnotatedRun[] = [
      makeAnnotatedRun({ repo: 'myorg/repoA', workflowName: 'CI', timing: t1 }),
    ];

    const result = buildRollupResult({ billing, runs, config: baseConfig });

    expect(result.reconciliation).toHaveLength(1);
    expect(result.reconciliation[0].repo).toBe('myorg/repoA');
    expect(result.reconciliation[0].billingMinutes).toBe(100);
    expect(result.reconciliation[0].timingMinutes).toBe(1);
    expect(result.reconciliation[0].ratio).toBeCloseTo(0.01, 3);
  });

  it('byRun is empty when config.by does not include "run"', () => {
    const billing: BillingResult = { available: false, items: [] };
    const t1 = makeRunTiming({ UBUNTU: { totalMs: 60_000, jobs: 1, jobRuns: [] } });
    const runs: AnnotatedRun[] = [
      makeAnnotatedRun({ repo: 'myorg/repoA', workflowName: 'CI', timing: t1 }),
    ];
    const result = buildRollupResult({ billing, runs, config: { ...baseConfig, by: new Set(['repo']) } });
    expect(result.byRun).toEqual([]);
  });

  it('byRun is populated when config.by includes "run"', () => {
    const billing: BillingResult = { available: false, items: [] };
    const t1 = makeRunTiming({ UBUNTU: { totalMs: 60_000, jobs: 1, jobRuns: [] } });
    const runs: AnnotatedRun[] = [
      makeAnnotatedRun({ repo: 'myorg/repoA', workflowName: 'CI', timing: t1 }),
    ];
    const result = buildRollupResult({ billing, runs, config: { ...baseConfig, by: new Set(['run']) } });
    expect(result.byRun).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// buildByRun
// ---------------------------------------------------------------------------

describe('buildByRun', () => {
  it('computes rawMs as sum of totalMs across all OS keys', () => {
    const t = makeRunTiming({
      UBUNTU: { totalMs: 60_000, jobs: 1, jobRuns: [] },
      MACOS:  { totalMs: 30_000, jobs: 1, jobRuns: [] },
    });
    const runs = [makeAnnotatedRun({ repo: 'myorg/repo', workflowName: 'CI', timing: t })];

    const result = buildByRun(runs);

    expect(result).toHaveLength(1);
    expect(result[0].rawMs).toBe(90_000);
  });

  it('computes billedMinutes using OS multipliers (MACOS = 10×)', () => {
    // MACOS 60s = ceil(60000/60000) * 10 = 10 min
    const t = makeRunTiming({ MACOS: { totalMs: 60_000, jobs: 1, jobRuns: [] } });
    const runs = [makeAnnotatedRun({ repo: 'myorg/repo', workflowName: 'CI', timing: t })];

    const result = buildByRun(runs);

    expect(result[0].billedMinutes).toBe(10);
  });

  it('computes billedMinutes across multiple OS keys in one run', () => {
    // UBUNTU 120s = ceil(2)*1 = 2 min; WINDOWS 60s = ceil(1)*2 = 2 min → 4 min total
    const t = makeRunTiming({
      UBUNTU:  { totalMs: 120_000, jobs: 1, jobRuns: [] },
      WINDOWS: { totalMs: 60_000,  jobs: 1, jobRuns: [] },
    });
    const runs = [makeAnnotatedRun({ repo: 'myorg/repo', workflowName: 'CI', timing: t })];

    const result = buildByRun(runs);

    expect(result[0].billedMinutes).toBe(4);
  });

  it('sets dominantOs to the OS with the largest totalMs', () => {
    const t = makeRunTiming({
      UBUNTU: { totalMs: 10_000, jobs: 1, jobRuns: [] },
      MACOS:  { totalMs: 60_000, jobs: 1, jobRuns: [] },
    });
    const runs = [makeAnnotatedRun({ repo: 'myorg/repo', workflowName: 'CI', timing: t })];

    const result = buildByRun(runs);

    expect(result[0].dominantOs).toBe('MACOS');
  });

  it('sets dominantOs to null when timing.billable is empty', () => {
    const t = makeRunTiming({});
    const runs = [makeAnnotatedRun({ repo: 'myorg/repo', workflowName: 'CI', timing: t })];

    const result = buildByRun(runs);

    // Zero-timing run should be excluded entirely
    expect(result).toHaveLength(0);
  });

  it('excludes runs with rawMs === 0 (no timing data)', () => {
    const tEmpty = makeRunTiming({});
    const tReal  = makeRunTiming({ UBUNTU: { totalMs: 60_000, jobs: 1, jobRuns: [] } });
    const runs = [
      makeAnnotatedRun({ repo: 'myorg/repo', workflowName: 'CI', timing: tEmpty }),
      makeAnnotatedRun({ repo: 'myorg/repo', workflowName: 'Deploy', timing: tReal }),
    ];

    const result = buildByRun(runs);

    expect(result).toHaveLength(1);
    expect(result[0].workflowName).toBe('Deploy');
  });

  it('sorts descending by billedMinutes', () => {
    const t1 = makeRunTiming({ UBUNTU: { totalMs: 60_000,  jobs: 1, jobRuns: [] } }); // 1 min
    const t2 = makeRunTiming({ UBUNTU: { totalMs: 300_000, jobs: 1, jobRuns: [] } }); // 5 min
    const t3 = makeRunTiming({ UBUNTU: { totalMs: 120_000, jobs: 1, jobRuns: [] } }); // 2 min
    const runs = [
      makeAnnotatedRun({ repo: 'myorg/repo', workflowName: 'CI',     timing: t1 }),
      makeAnnotatedRun({ repo: 'myorg/repo', workflowName: 'Deploy', timing: t2 }),
      makeAnnotatedRun({ repo: 'myorg/repo', workflowName: 'Lint',   timing: t3 }),
    ];

    const result = buildByRun(runs);

    expect(result[0].billedMinutes).toBe(5);
    expect(result[1].billedMinutes).toBe(2);
    expect(result[2].billedMinutes).toBe(1);
  });

  it('preserves repo and runId on each RunRollup', () => {
    const t = makeRunTiming({ UBUNTU: { totalMs: 60_000, jobs: 1, jobRuns: [] } });
    const runs = [makeAnnotatedRun({ repo: 'myorg/my-repo', workflowName: 'CI', timing: t })];

    const result = buildByRun(runs);

    expect(result[0].repo).toBe('myorg/my-repo');
    expect(result[0].runId).toBe(t.runId);
  });

  it('returns empty array for empty input', () => {
    expect(buildByRun([])).toEqual([]);
  });

  it('includes runs with deprecated zero total_ms when runDurationMs is set (GitHub API fallback)', () => {
    // Real-world case: GitHub now returns total_ms=0 for all billable entries but
    // run_duration_ms=431000 still lives on the same response. The old code filtered
    // these out (rawMs===0 guard), leaving byRun empty. After the fix, the run must appear.
    const timing: RunTiming = {
      runId: 42,
      billable: {
        UBUNTU: { totalMs: 0, jobs: 6, jobRuns: [] },
      },
      runDurationMs: 431_000, // 7m 11s wall-clock
    };
    const runs = [makeAnnotatedRun({ repo: 'myorg/repo', workflowName: 'CI', timing })];

    const result = buildByRun(runs);

    expect(result).toHaveLength(1);
    expect(result[0].rawMs).toBe(431_000);
    expect(result[0].dominantOs).toBe('UBUNTU');
    // ceil(431000 / 60000) * UBUNTU(1×) = ceil(7.183) * 1 = 8 min
    expect(result[0].billedMinutes).toBe(8);
    expect(result[0].runId).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// effectiveOsMs
// ---------------------------------------------------------------------------

describe('effectiveOsMs', () => {
  it('passes through real totalMs values when any OS has non-zero totalMs', () => {
    const timing: RunTiming = {
      runId: 1,
      billable: {
        UBUNTU: { totalMs: 60_000, jobs: 2, jobRuns: [] },
        MACOS:  { totalMs: 30_000, jobs: 1, jobRuns: [] },
      },
    };

    const result = effectiveOsMs(timing);

    expect(result).toContainEqual(['UBUNTU', 60_000]);
    expect(result).toContainEqual(['MACOS',  30_000]);
  });

  it('assigns all runDurationMs to the single OS bucket when billable totals are all zero', () => {
    // Single OS bucket, 6 jobs — all machine-time goes to UBUNTU
    const timing: RunTiming = {
      runId: 1,
      billable: {
        UBUNTU: { totalMs: 0, jobs: 6, jobRuns: [] },
      },
      runDurationMs: 431_000,
    };

    const result = effectiveOsMs(timing);

    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe('UBUNTU');
    expect(result[0][1]).toBe(431_000);
  });

  it('splits runDurationMs proportionally by job count when multiple OS buckets present', () => {
    // 3 UBUNTU jobs, 1 MACOS job → 3/4 Ubuntu, 1/4 MACOS
    const timing: RunTiming = {
      runId: 1,
      billable: {
        UBUNTU: { totalMs: 0, jobs: 3, jobRuns: [] },
        MACOS:  { totalMs: 0, jobs: 1, jobRuns: [] },
      },
      runDurationMs: 400_000,
    };

    const result = effectiveOsMs(timing);
    const ubuntu = result.find(([os]) => os === 'UBUNTU')![1];
    const macos  = result.find(([os]) => os === 'MACOS')![1];

    expect(ubuntu).toBeCloseTo(300_000, 1); // 3/4 × 400_000
    expect(macos).toBeCloseTo(100_000, 1);  // 1/4 × 400_000
  });

  it('returns zeros for each OS key when both totalMs and runDurationMs are zero', () => {
    const timing: RunTiming = {
      runId: 1,
      billable: { UBUNTU: { totalMs: 0, jobs: 1, jobRuns: [] } },
      runDurationMs: 0,
    };

    const result = effectiveOsMs(timing);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(['UBUNTU', 0]);
  });

  it('returns empty array when billable is empty', () => {
    const timing: RunTiming = { runId: 1, billable: {} };
    expect(effectiveOsMs(timing)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// estimatedMinutesForRun — fallback branch
// ---------------------------------------------------------------------------

describe('estimatedMinutesForRun', () => {
  it('computes billed minutes from real totalMs (normal path)', () => {
    // UBUNTU 120s = ceil(2) × 1 = 2 min
    const t = makeRunTiming({ UBUNTU: { totalMs: 120_000, jobs: 1, jobRuns: [] } });
    const run = makeAnnotatedRun({ timing: t });
    expect(estimatedMinutesForRun(run)).toBe(2);
  });

  it('uses runDurationMs fallback when all totalMs are zero (deprecated endpoint)', () => {
    // UBUNTU with total_ms=0, but run_duration_ms=120_000 → ceil(2)×1 = 2 min
    const t: RunTiming = {
      runId: 1,
      billable: { UBUNTU: { totalMs: 0, jobs: 1, jobRuns: [] } },
      runDurationMs: 120_000,
    };
    const run = makeAnnotatedRun({ timing: t });
    expect(estimatedMinutesForRun(run)).toBe(2);
  });

  it('applies MACOS 10× multiplier through the fallback path', () => {
    // MACOS with total_ms=0, run_duration_ms=60_000 → ceil(1)×10 = 10 min
    const t: RunTiming = {
      runId: 1,
      billable: { MACOS: { totalMs: 0, jobs: 1, jobRuns: [] } },
      runDurationMs: 60_000,
    };
    const run = makeAnnotatedRun({ timing: t });
    expect(estimatedMinutesForRun(run)).toBe(10);
  });
});
