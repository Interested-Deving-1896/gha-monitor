import type { OctokitClient } from './client.js';

export interface Repo {
  name: string;
  fullName: string;  // "org/repo"
  private: boolean;
}

export async function listRepos(octokit: OctokitClient, org: string): Promise<Repo[]> {
  const repos = await octokit.paginate('GET /orgs/{org}/repos', {
    org,
    per_page: 100,
    type: 'all',
  });
  return repos.map(r => ({
    name: r.name,
    fullName: r.full_name,
    private: r.private,
  }));
}
