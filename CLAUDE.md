# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Commands

```bash
npm run build        # compile TypeScript → dist/
npm run dev          # run CLI directly via tsx (no build step, for local dev)
npm test             # run all tests once
npm run test:watch   # watch mode

# Run a single test file
npx vitest run src/core/multipliers.test.ts

# Run the CLI after building
node dist/cli.js --org <your-org> --no-timing
```

All local imports must use `.js` extensions (NodeNext ESM requirement), even though the source files are `.ts`.

## Auth / environment

Copy `.env` → `.env.local` and set `GH_TOKEN`. `.env.local` is gitignored; `.env` is the committed example. The CLI also accepts `--token` or the `GITHUB_TOKEN` env var. Token scopes needed: `repo` + `manage_billing:org` + `read:org` (classic PAT).

## Architecture

The tool combines two GitHub data sources and has a strict layering rule: **`github/*` does I/O only, `core/*` is pure (no network), `output/*` is pure formatting, `cli.ts` wires them.**

### Two data sources

**Source 1 — Enhanced billing usage API** (`github/billing.ts`)
`GET /organizations/{org}/settings/billing/usage` — returns line items where `quantity` is already billed minutes with OS multipliers applied. This is the authority for *how many minutes*. Gracefully falls back (returns `{ available: false }`) on 403/404. The `day` parameter is intentionally omitted — the API returns MTD when `day` is passed, so we fetch the full month and filter client-side by `sinceISO`/`untilISO`.

**Source 2 — Per-run timing API** (`github/timing.ts`)
`GET /repos/{owner}/{repo}/actions/runs/{run_id}/timing` — returns raw milliseconds per OS (UBUNTU/MACOS/WINDOWS). **No multiplier is applied.** Used to answer *which workflow/job* within a repo. Wrapped in try/catch — returns empty `billable: {}` on failure (endpoint is being deprecated).

### OS billing multipliers (`core/multipliers.ts`)

```
UBUNTU: 1×   WINDOWS: 2×   MACOS: 10×
billedMinutes(os, totalMs) = ceil(totalMs / 60000) * MULTIPLIER[os]
```

Rounding happens **per run** before summing. `skuToOsKey()` maps SKU strings via substring matching (e.g. `"Actions Linux 4-core"` → `UBUNTU`) so large-runner variants merge into the same OS bucket.

### Aggregation (`core/aggregate.ts`)

Key design principle: **billing is the authority for minutes; timing is used only to apportion those minutes across workflows/jobs**.

- `rollupByRepo` / `rollupByOs` — group and sum billing `LineItem[]`
- `computeTimingByRepo` — estimate billed minutes from raw timing (for reconciliation)
- `apportionByWorkflow(runs, repoBilledMinutes)` — proportional split; last element adjusted to enforce the invariant `sum(billedMinutes) === repoBilledMinutes`
- `apportionByJob(wfRuns, wf.billedMinutes)` — called per-workflow (not per-repo) so job minutes stay bounded by their workflow's allocation
- `buildRollupResult` — orchestrates everything; `totalBilledMinutes` is computed from the full billing item set before the `top-N` slice

Reconciliation ratio (`timingMin / billingMin`) flags repos where estimates diverge from billing by >20%, indicating non-default runner sizes or self-hosted minutes.

### CLI orchestration (`cli.ts`)

Order of operations:
1. Load `.env` then `.env.local` (dotenv, top of file before any imports)
2. `resolveConfig` → validate flags
3. `fetchBillingUsage` → source of truth
4. `listRepos` → full org repo list
5. Select target repos: if billing available, sort by billed minutes and take `--top N`; else scan all
6. Timing fan-out: **two separate `pLimit` pools** — `repoLimit(concurrency)` for outer per-repo tasks, `runLimit(concurrency * 4)` for inner per-run calls. A single shared pool would deadlock when `targetRepos.length >= concurrency`.
7. `buildRollupResult` → aggregate
8. Render table/json/csv to stdout; all progress messages go to stderr

### `--by` flag controls both API calls and output sections

`config.by` is a `Set<'repo' | 'workflow' | 'job' | 'os'>`. In `buildRollupResult`, `wantWorkflow = by.has('workflow') || by.has('job')` gates whether `apportionByWorkflow` is called. In `cli.ts`, `by.has('job')` gates whether `fetchJobNames` is called per run.

### Output (`output/`)

Three pure formatters take `RollupResult` and return a string. The `--by` set controls which sections appear in the table. CSV uses a fallback hierarchy: `byJob → byWorkflow → byRepo`. The `rawMinApprox` and `multiplier` columns in CSV use the repo's dominant OS as an approximation for workflow/job rows (data model limitation — `WorkflowRollup`/`JobRollup` carry no `os` field).

## Testing

Tests live next to source files as `*.test.ts`. All tested modules are pure functions — tests use fixture data and fake Octokit objects (inject via parameter, no live HTTP). The `apportionByWorkflow` and `apportionByJob` tests include a floating-point drift invariant case (three equal shares summing to a whole number).
