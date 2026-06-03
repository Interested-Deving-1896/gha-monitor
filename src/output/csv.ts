import type { RollupResult } from '../core/types.js';
import { MULTIPLIER } from '../core/multipliers.js';

/** Escape a single CSV field value: wrap in quotes if it contains comma, quote, newline, or carriage return. */
function csvField(value: string | number): string {
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function csvRow(fields: (string | number)[]): string {
  return fields.map(csvField).join(',');
}

/**
 * One row per leaf entry. Headers: repo,workflow,job,os,rawMinApprox,multiplier,billedMin,runId,runStartedAt,durationSec
 *
 * Priority:
 * 1. If byRun is populated  → one row per run (runId and durationSec filled).
 * 2. Else if byJob is populated  → one row per job.
 * 3. Else if byWorkflow is populated → one row per workflow (job = "").
 * 4. Else → one row per repo (workflow = "", job = "").
 *
 * Note: the `os`, `rawMinApprox`, and `multiplier` columns use the repo's dominant OS
 * as an approximation for workflow/job rows. Per-run rows use the run's own dominantOs.
 */
export function renderCsv(result: RollupResult): string {
  const headers = 'repo,workflow,job,os,rawMinApprox,multiplier,billedMin,runId,runStartedAt,durationSec';
  const rows: string[] = [headers];

  // Build a lookup from repo -> dominant OS for fallback columns
  const repoOs = new Map<string, string>();
  for (const r of result.byRepo) {
    repoOs.set(r.repo, r.dominantOs ?? '');
  }

  // Build a lookup from OS -> multiplier
  const osMultiplier = new Map<string, number>();
  for (const o of result.byOs) {
    osMultiplier.set(o.os, o.multiplier);
  }

  if (result.byRun.length > 0) {
    for (const run of result.byRun) {
      const os = run.dominantOs ?? '';
      const mult = run.dominantOs ? MULTIPLIER[run.dominantOs] : 1;
      const rawMin = Math.round(run.rawMs / 60_000);
      const durationSec = Math.round(run.rawMs / 1_000);
      rows.push(csvRow([run.repo, run.workflowName, '', os, rawMin, mult, run.billedMinutes, run.runId, run.runStartedAt, durationSec]));
    }
  } else if (result.byJob.length > 0) {
    for (const job of result.byJob) {
      const os = repoOs.get(job.repo) ?? '';
      const mult = osMultiplier.get(os) ?? 1;
      const rawMin = mult > 0 ? Math.round(job.billedMinutes / mult) : job.billedMinutes;
      rows.push(csvRow([job.repo, job.workflowName, job.jobName, os, rawMin, mult, job.billedMinutes, '', '', '']));
    }
  } else if (result.byWorkflow.length > 0) {
    for (const wf of result.byWorkflow) {
      const os = repoOs.get(wf.repo) ?? '';
      const mult = osMultiplier.get(os) ?? 1;
      const rawMin = mult > 0 ? Math.round(wf.billedMinutes / mult) : wf.billedMinutes;
      rows.push(csvRow([wf.repo, wf.workflowName, '', os, rawMin, mult, wf.billedMinutes, '', '', '']));
    }
  } else {
    for (const repo of result.byRepo) {
      const os = repo.dominantOs ?? '';
      const mult = osMultiplier.get(os) ?? 1;
      const rawMin = mult > 0 ? Math.round(repo.billedMinutes / mult) : repo.billedMinutes;
      rows.push(csvRow([repo.repo, '', '', os, rawMin, mult, repo.billedMinutes, '', '', '']));
    }
  }

  return rows.join('\n') + '\n';
}
