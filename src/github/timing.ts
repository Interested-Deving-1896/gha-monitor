import type { OctokitClient } from './client.js';
import type { RunTiming, OsTiming, OsKey } from '../core/types.js';

export async function fetchRunTiming(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  runId: number,
): Promise<RunTiming> {
  const response = await octokit.request(
    'GET /repos/{owner}/{repo}/actions/runs/{run_id}/timing',
    { owner, repo, run_id: runId }
  );

  // The response shape: response.data.billable is an object keyed by OS
  // e.g. { UBUNTU: { total_ms: 5000, jobs: 1, job_runs: [{job_id: 123, duration_ms: 5000}] } }
  // Map to our RunTiming type.

  const osKeys: OsKey[] = ['UBUNTU', 'MACOS', 'WINDOWS'];
  const billable: Partial<Record<OsKey, OsTiming>> = {};

  for (const os of osKeys) {
    const raw = (response.data.billable as Record<string, unknown>)[os];
    if (raw && typeof raw === 'object') {
      const r = raw as { total_ms: number; jobs: number; job_runs: Array<{job_id: number; duration_ms: number}> };
      billable[os] = {
        totalMs: r.total_ms,
        jobs: r.jobs,
        jobRuns: r.job_runs.map(jr => ({ jobId: jr.job_id, durationMs: jr.duration_ms })),
      };
    }
  }

  return { runId, billable };
}

/**
 * Fetch job names for a run. Only call when --by job is requested.
 * Returns a Map of jobId -> job name.
 */
export async function fetchJobNames(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  runId: number,
): Promise<Map<number, string>> {
  const jobs = await octokit.paginate(
    'GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs',
    { owner, repo, run_id: runId, per_page: 100 }
  );
  return new Map(jobs.map(j => [j.id, j.name]));
}
