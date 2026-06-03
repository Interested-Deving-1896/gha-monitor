import type { OctokitClient } from './client.js';

export interface WorkflowRun {
  id: number;
  name: string | null;         // workflow name
  workflowId: number;
  headBranch: string | null;
  createdAt: string;           // ISO timestamp
  status: string | null;
  conclusion: string | null;
}

export async function listRuns(
  octokit: OctokitClient,
  owner: string,
  repo: string,
  sinceISO: string,            // e.g. "2024-03-01"
): Promise<WorkflowRun[]> {
  const runs = await octokit.paginate('GET /repos/{owner}/{repo}/actions/runs', {
    owner,
    repo,
    created: `>=${sinceISO}`,  // server-side date filter
    per_page: 100,
  });
  return runs.map(r => ({
    id: r.id,
    name: r.name ?? null,
    workflowId: r.workflow_id,
    headBranch: r.head_branch ?? null,
    createdAt: r.created_at,
    status: r.status ?? null,
    conclusion: r.conclusion ?? null,
  }));
}
