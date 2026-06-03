# gha-monitor

GitHub Actions usage insights CLI — analyze billable minutes by repo, workflow, job, and runner OS.

## What it does

`gha-monitor` queries the GitHub API to surface GitHub Actions usage data across your organization or repositories. It aggregates billable minutes broken down by:

- Repository
- Workflow
- Job
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

# Output as JSON
node dist/cli.js --org my-org --json

# Output as CSV
node dist/cli.js --org my-org --csv
```

> **Dev shortcut:** replace `node dist/cli.js` with `npm run dev --` to run via tsx without a build step.

## Output

The default table output shows:

| Column | Description |
|---|---|
| Repo | Repository name |
| Workflow | Workflow file name |
| OS | Runner OS (ubuntu, macos, windows) |
| Runs | Number of completed runs in the window |
| Minutes | Total billable minutes (with OS multiplier applied) |

## License

MIT
