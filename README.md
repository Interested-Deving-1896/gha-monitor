# gha-monitor

GitHub Actions usage insights CLI — analyze billable minutes by repo, workflow, job, run, and runner OS.

## What it does

`gha-monitor` queries the GitHub API to surface GitHub Actions usage data across your organization or repositories. It aggregates billable minutes broken down by:

- Repository
- Workflow
- Job
- Individual run (duration + billed minutes per run)
- Runner OS (Linux, macOS, Windows) — with billing multipliers applied

Results can be output as a formatted table (default), JSON, or CSV for further analysis.

## Prerequisites

- **Node.js 20+**
- **GitHub Personal Access Token (PAT)** with the following scopes:
  - Classic PAT: `repo` + `manage_billing:org` (billing API) + `read:org` (list org repos and runs)
  - Fine-grained alternative: org Administration: read + Actions: read + Billing: read

Set your token in `.env.local` (gitignored, never committed):

```sh
cp .env .env.local
# then edit .env.local and set GH_TOKEN=ghp_your_token_here
```

`.env` is a committed example file with placeholder values. `.env.local` overrides it with your real token. You can also pass the token directly with `--token` or via the `GH_TOKEN` / `GITHUB_TOKEN` environment variable.

## Installation

Clone the repo and install dependencies. The `prepare` script compiles TypeScript to `dist/` automatically on install:

```sh
git clone <repo-url> gha-monitor
cd gha-monitor
npm install
```

Then run the CLI from the repo directory (so `.env.local` is picked up):

```sh
node dist/cli.js --org my-org
# or, without a build step, during development:
npm run dev -- --org my-org
```

## Usage

```sh
# Analyze an entire organization (last 7 days by default)
node dist/cli.js --org my-org

# Limit to the last 14 days
node dist/cli.js --org my-org --days 14

# Skip per-job timing data (faster, uses only billing API)
node dist/cli.js --org my-org --no-timing

# Show only the top 1 repo
node dist/cli.js --org my-org --top 1

# Break down by workflow
node dist/cli.js --org my-org --by workflow

# Show individual run durations and billed minutes (top 20 by default)
node dist/cli.js --org my-org --by run

# Show up to 50 runs
node dist/cli.js --org my-org --by run --top 50

# Show all runs (no cap)
node dist/cli.js --org my-org --by run --top all

# Output as JSON (byRun array always uncapped)
node dist/cli.js --org my-org --by run --json

# Output as CSV with runId and durationSec columns
node dist/cli.js --org my-org --by run --csv
```

> **Dev shortcut:** replace `node dist/cli.js` with `npm run dev --` to run via tsx without a build step.

## Output

The default table output shows:

| Column | Description |
|---|---|
| Repo | Repository name |
| Workflow | Workflow file name |
| OS | Runner OS (ubuntu, macos, windows) |
| Minutes | Total billable minutes (with OS multiplier applied) |

When `--by run` is active, a **By Run** section is appended:

| Column | Description |
|---|---|
| Repo / Workflow | Repository and workflow name |
| Run ID | GitHub Actions run ID |
| Duration | Wall-clock run duration as `Xm YYs` (from GitHub's `run_duration_ms`; OS multiplier is applied to estimate billed minutes) |
| Billed min | Estimated billed minutes (OS multiplier applied) |
| OS | Dominant OS for the run, with multiplier noted for macOS/Windows |

The table shows up to 20 runs by default; use `--top N` or `--top all` to change the cap. JSON and CSV always include the full uncapped list. The CSV adds `runId` and `durationSec` columns (whole seconds, floored).

## License

MIT
