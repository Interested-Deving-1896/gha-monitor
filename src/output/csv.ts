import type { RollupResult } from '../core/types.js';

/** Escape a single CSV field value: wrap in quotes if it contains comma, quote, or newline. */
function csvField(value: string | number): string {
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function csvRow(fields: (string | number)[]): string {
  return fields.map(csvField).join(',');
}

/**
 * One row per leaf entry. Headers: repo,workflow,job,os,rawMinApprox,multiplier,billedMin
 *
 * Priority:
 * 1. If byJob is populated  → one row per job.
 * 2. Else if byWorkflow is populated → one row per workflow (job = "").
 * 3. Else → one row per repo (workflow = "", job = "").
 */
export function renderCsv(result: RollupResult): string {
  const headers = 'repo,workflow,job,os,rawMinApprox,multiplier,billedMin';
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

  if (result.byJob.length > 0) {
    for (const job of result.byJob) {
      const os = repoOs.get(job.repo) ?? '';
      const mult = osMultiplier.get(os) ?? 1;
      const rawMin = mult > 0 ? Math.round(job.billedMinutes / mult) : job.billedMinutes;
      rows.push(csvRow([job.repo, job.workflowName, job.jobName, os, rawMin, mult, job.billedMinutes]));
    }
  } else if (result.byWorkflow.length > 0) {
    for (const wf of result.byWorkflow) {
      const os = repoOs.get(wf.repo) ?? '';
      const mult = osMultiplier.get(os) ?? 1;
      const rawMin = mult > 0 ? Math.round(wf.billedMinutes / mult) : wf.billedMinutes;
      rows.push(csvRow([wf.repo, wf.workflowName, '', os, rawMin, mult, wf.billedMinutes]));
    }
  } else {
    for (const repo of result.byRepo) {
      const os = repo.dominantOs ?? '';
      const mult = osMultiplier.get(os) ?? 1;
      const rawMin = mult > 0 ? Math.round(repo.billedMinutes / mult) : repo.billedMinutes;
      rows.push(csvRow([repo.repo, '', '', os, rawMin, mult, repo.billedMinutes]));
    }
  }

  return rows.join('\n');
}
