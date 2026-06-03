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
  - `repo` — read access to repositories and workflow runs
  - `admin:org` — read access to organization billing data

Set your token via the `GITHUB_TOKEN` environment variable:

```sh
export GITHUB_TOKEN=ghp_your_token_here
```

## Installation

```sh
npm install -g gha-monitor
```

## Usage

```sh
# Analyze an entire organization (last 30 days by default)
gha-monitor --org my-org

# Limit to the last 7 days
gha-monitor --org my-org --days 7

# Skip per-job timing data (faster, uses only billing API)
gha-monitor --org my-org --no-timing

# Output as JSON
gha-monitor --org my-org --json

# Output as CSV
gha-monitor --org my-org --csv

# Analyze a single repository
gha-monitor --repo my-org/my-repo --days 14
```

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
