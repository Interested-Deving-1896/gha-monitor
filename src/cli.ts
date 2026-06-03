import 'dotenv/config';
import { config as dotenvLocal } from 'dotenv';
dotenvLocal({ path: '.env.local', override: true });

import { program } from 'commander';
import pLimit from 'p-limit';
import { resolveConfig } from './config.js';
import { createClient } from './github/client.js';
import { fetchBillingUsage } from './github/billing.js';
import { listRepos } from './github/repos.js';
import { listRuns } from './github/runs.js';
import { fetchRunTiming, fetchJobNames } from './github/timing.js';
import { buildRollupResult } from './core/aggregate.js';
import { renderTable } from './output/table.js';
import { renderJson } from './output/json.js';
import { renderCsv } from './output/csv.js';
import type { AnnotatedRun } from './core/types.js';

/** Parse --top: accepts a positive integer or "all" (case-insensitive) → Infinity. */
function parseTop(v: string): number {
  if (v.toLowerCase() === 'all') return Infinity;
  const n = parseInt(v, 10);
  if (isNaN(n) || n < 1) throw new Error(`--top must be a positive integer or "all". Got: "${v}".`);
  return n;
}

program
  .name('gha-monitor')
  .description('GitHub Actions usage insights — by repo, workflow, job, run, and runner OS')
  .version('0.1.0')
  .requiredOption('--org <name>', 'GitHub organization name')
  .option('--days <n>', 'rolling window in days (default: 7)', parseInt)
  .option('--month <m>', 'calendar month (1-12), requires --year', parseInt)
  .option('--year <y>', 'calendar year, requires --month', parseInt)
  .option('--by <dims>', 'dimensions: comma-separated repo,workflow,job,os,run (default: repo,os)')
  .option('--top <n>', 'top N repos for timing drill-down; also caps By-Run rows (default: 10, "all" = no cap)', parseTop)
  .option('--source <s>', 'data source: billing|timing|auto (default: auto)')
  .option('--no-timing', 'skip per-run timing fan-out (billing only)')
  .option('--concurrency <n>', 'API concurrency limit (default: 8)', parseInt)
  .option('--json', 'output as JSON')
  .option('--csv', 'output as CSV')
  .option('--token <t>', 'GitHub PAT (default: $GH_TOKEN or $GITHUB_TOKEN)')
  .option('--quota <n>', 'monthly minute quota for reporting', parseInt, 3000);

program.action(async (opts) => {
  try {
    // 1. resolveConfig — validates all opts, throws on invalid input
    // Commander parses --no-timing as timing: false; map that to noTiming: true
    const resolvedOpts = {
      ...opts,
      noTiming: opts.timing === false ? true : (opts.noTiming ?? false),
    };
    const config = resolveConfig(resolvedOpts);
    const quota = opts.quota as number;
    // runDisplayLimit: honour explicit --top (including "all"→Infinity), default 20 when not passed
    const runDisplayLimit: number = opts.top !== undefined ? config.top : 20;

    // 2. createClient
    const octokit = createClient(config.token);

    // 3. fetchBillingUsage — this is the source of truth for minutes
    console.error('Fetching billing usage...');
    const billing = await fetchBillingUsage(octokit, config.org, config.window);
    if (!billing.available) {
      console.error('⚠  Enhanced billing API unavailable — falling back to per-run timing.');
    }

    // 4. listRepos — get the full org repo list
    console.error('Fetching repo list...');
    const allRepos = await listRepos(octokit, config.org);

    // 5. Determine which repos to drill into for timing
    //    If billing available: sort by billing minutes, take top-N
    //    If billing not available: use all repos (warn: may be slow)
    let targetRepos: string[]; // full_name values
    if (billing.available && billing.items.length > 0) {
      // Group billing items by repo, sort by total minutes desc, take top config.top
      const repoMinutes = new Map<string, number>();
      for (const item of billing.items) {
        if (item.repositoryName) {
          repoMinutes.set(item.repositoryName, (repoMinutes.get(item.repositoryName) ?? 0) + item.quantity);
        }
      }
      const repoByName = new Map(allRepos.map(r => [r.name, r]));
      targetRepos = [...repoMinutes.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, config.top)
        .map(([repo]) => {
          // billing items have just the repo name, not full_name
          // find the matching full_name from allRepos
          const found = repoByName.get(repo) ?? allRepos.find(r => r.fullName.endsWith('/' + repo));
          return found?.fullName ?? `${config.org}/${repo}`;
        });
    } else {
      targetRepos = allRepos.map(r => r.fullName);
      if (allRepos.length > config.top) {
        console.error(`⚠  Scanning all ${allRepos.length} repos (no billing data to prioritize). Use --top to limit.`);
      }
    }

    // 6. Per-run timing fan-out (unless --no-timing)
    const annotatedRuns: AnnotatedRun[] = [];

    if (!config.noTiming) {
      console.error(`Fetching runs for ${targetRepos.length} repos (concurrency: ${config.concurrency})...`);
      const repoLimit = pLimit(config.concurrency);
      const runLimit = pLimit(config.concurrency * 4);
      const needJobs = config.by.has('job');

      await Promise.all(targetRepos.map(fullName => repoLimit(async () => {
        const [owner, repo] = fullName.split('/');

        // List runs with server-side date filter (bounded by untilISO when set)
        const runs = await listRuns(octokit, owner, repo, config.window.sinceISO, config.window.untilISO);
        console.error(`  ${fullName}: ${runs.length} runs`);

        // For each run, fetch timing (separate pool to avoid deadlock with outer repoLimit)
        await Promise.all(runs.map(run => runLimit(async () => {
          const timing = await fetchRunTiming(octokit, owner, repo, run.id);

          let jobNames: Map<number, string> | undefined;
          if (needJobs) {
            try {
              jobNames = await fetchJobNames(octokit, owner, repo, run.id);
            } catch (err) {
              console.error(`  ⚠ Could not fetch job names for run ${run.id}: ${err instanceof Error ? err.message : String(err)}`);
              jobNames = new Map();
            }
          }

          annotatedRuns.push({
            repo: fullName,
            workflowName: run.name ?? 'unknown',
            runId: run.id,
            timing,
            jobNames,
          });
        })));
      })));
    }

    // 7. Build rollup result
    console.error('Computing rollup...');
    const result = buildRollupResult({ billing, runs: annotatedRuns, config });

    // 7a. Warn if --by run was requested but produced nothing (helps diagnose API changes)
    if (config.by.has('run') && !config.noTiming && result.byRun.length === 0) {
      console.error('⚠  --by run: no per-run timing data available for the selected window. The GitHub /timing endpoint may have been deprecated or no runs were found.');
    }

    // 8. Print rate limit remaining
    try {
      const rl = await octokit.rest.rateLimit.get();
      const remaining = rl.data.resources.core.remaining;
      const resetAt = new Date(rl.data.resources.core.reset * 1000).toISOString().substring(11, 19);
      console.error(`Rate limit: ${remaining} requests remaining (resets at ${resetAt})`);
    } catch {
      // non-fatal
    }

    // 9. Render output
    let output: string;
    if (config.outputFormat === 'json') {
      output = renderJson(result);
    } else if (config.outputFormat === 'csv') {
      output = renderCsv(result);
    } else {
      output = renderTable(result, quota, runDisplayLimit);
    }

    process.stdout.write(output);

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    if (process.env['DEBUG']) {
      console.error(err);
    }
    process.exit(1);
  }
});

program.parse();
