[update-readmes]   Mode: rewrite — migrating to template structure...
# gha-monitor

[![Built with Ona](https://ona.com/build-with-ona.svg)](https://app.ona.com/#https://github.com/Interested-Deving-1896/gha-monitor)

<!-- AI:start:what-it-does -->
_Description pending._
<!-- AI:end:what-it-does -->

## Architecture

<!-- AI:start:architecture -->
_Architecture documentation pending._
<!-- AI:end:architecture -->

## Install

<!-- Add installation instructions here. This section is yours — the AI will not modify it. -->

```bash
git clone https://github.com/Interested-Deving-1896/gha-monitor.git
cd gha-monitor
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

## Configuration

<!-- Document configuration options here. This section is yours — the AI will not modify it. -->

## CI

<!-- AI:start:ci -->
_CI documentation pending._
<!-- AI:end:ci -->

## Mirror chain

<!-- AI:start:mirror-chain -->
This repo is maintained in [`Interested-Deving-1896/gha-monitor`](https://github.com/Interested-Deving-1896/gha-monitor) and mirrored through:

```
Interested-Deving-1896/gha-monitor  ──►  OpenOS-Project-OSP/gha-monitor  ──►  OpenOS-Project-Ecosystem-OOC/gha-monitor
```

Changes flow downstream automatically via the hourly mirror chain in
[`fork-sync-all`](https://github.com/Interested-Deving-1896/fork-sync-all).
Direct commits to OSP or OOC are detected and opened as PRs back to `Interested-Deving-1896`.
<!-- AI:end:mirror-chain -->

## Contributors

<!-- AI:start:contributors -->
_Contributors pending._
<!-- AI:end:contributors -->

## Origins

<!-- AI:start:origins -->
_Original project — no upstream fork._
<!-- AI:end:origins -->

## Resources

<!-- AI:start:resources -->
_No additional resource files found._
<!-- AI:end:resources -->

## License

<!-- AI:start:license -->
[MIT](https://github.com/Interested-Deving-1896/gha-monitor/blob/main/LICENSE) © 2026 [Interested-Deving-1896](https://github.com/Interested-Deving-1896)
<!-- AI:end:license -->
