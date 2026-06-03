import type { RollupResult } from '../core/types.js';
import { daysInMonth } from '../core/window.js';

const RULER_WIDTH = 55; // total line width

function ruler(char: string): string {
  return char.repeat(RULER_WIDTH);
}

function sectionHeader(title: string): string {
  // prefix is `── <title> ─` = 4 + title.length chars; pad to RULER_WIDTH
  const prefixLen = 4 + title.length;
  const right = '─'.repeat(Math.max(0, RULER_WIDTH - prefixLen));
  return `── ${title} ─${right}`;
}

function monthLabel(year: number, month: number): string {
  const MONTHS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${MONTHS[month - 1]} ${year}`;
}

function sourceLabel(source: RollupResult['source']): string {
  switch (source) {
    case 'billing': return 'billing API  ✓';
    case 'timing-estimated': return 'timing estimate  ~';
    case 'mixed': return 'billing + timing';
  }
}

function pct(n: number, total: number): string {
  if (total === 0) return '0.0%';
  return ((n / total) * 100).toFixed(1) + '%';
}

/** Escape CSV is not needed here, but we pad columns for table display */
function col(value: string | number, width: number, right = false): string {
  const s = String(value);
  return right ? s.padStart(width) : s.padEnd(width);
}

export function renderTable(result: RollupResult, quota: number): string {
  const lines: string[] = [];
  const { org, window: win, totalBilledMinutes, byOs, byRepo, byWorkflow, byJob, reconciliation, source } = result;
  const dim = daysInMonth(win.year, win.month);

  // ── Headline ─────────────────────────────────────────
  lines.push(ruler('═'));
  lines.push(` GitHub Actions Usage  ·  org: ${org}  ·  ${monthLabel(win.year, win.month)}`);
  const untilLabel = win.untilISO ?? `${win.year}-${String(win.month).padStart(2, '0')}-${String(dim).padStart(2, '0')}`;
  lines.push(` Window: ${win.sinceISO} → ${untilLabel}  (${win.daysInWindow} days)`);
  lines.push(ruler('═'));

  const usedPct = quota > 0 ? ((totalBilledMinutes / quota) * 100).toFixed(1) : '0.0';
  lines.push(` Total billed:   ${Math.round(totalBilledMinutes)} / ${Math.round(quota)} min   (${usedPct}%)`);

  // Projection: use daysInWindow as elapsed days
  const burnPerDay = win.daysInWindow > 0 ? totalBilledMinutes / win.daysInWindow : 0;
  const projected = Math.round(burnPerDay * dim);
  const projPct = quota > 0 ? ((projected / quota) * 100).toFixed(1) : '0.0';
  lines.push(` Projected EOMonth: ~${projected} min   (${projPct}%)  [burn: ${burnPerDay.toFixed(1)} min/day]`);
  lines.push(` Source: ${sourceLabel(source)}`);
  lines.push(ruler('═'));

  // ── By Runner OS ─────────────────────────────────────
  lines.push(sectionHeader('By Runner OS'));
  const osColW = 10;
  const numColW = 12;
  lines.push(
    '  ' +
    col('OS', osColW) +
    col('Raw min (≈)', numColW, true) +
    col('Mult', 6, true) +
    col('Billed min', numColW, true) +
    col('% of total', 12, true),
  );
  let hasMacos = false;
  let hasWindows = false;
  for (const row of byOs) {
    const rawMin = row.multiplier > 0 ? Math.round(row.billedMinutes / row.multiplier) : row.billedMinutes;
    const multLabel = `${row.multiplier}×`;
    const pctLabel = pct(row.billedMinutes, totalBilledMinutes);
    lines.push(
      '  ' +
      col(row.os, osColW) +
      col(rawMin, numColW, true) +
      col(multLabel, 6, true) +
      col(row.billedMinutes, numColW, true) +
      col(pctLabel, 12, true),
    );
    if (row.os === 'MACOS' && row.billedMinutes > 0) hasMacos = true;
    if (row.os === 'WINDOWS' && row.billedMinutes > 0) hasWindows = true;
  }
  if (hasMacos) {
    lines.push('');
    lines.push('  ⚠  macOS runners detected — billed at 10× wall-clock time!');
  }
  if (hasWindows) {
    lines.push('');
    lines.push('  ⚠  Windows runners detected — billed at 2× wall-clock time!');
  }
  lines.push('');

  // ── By Repository ─────────────────────────────────────
  lines.push(sectionHeader('By Repository'));
  const repoColW = 32;
  lines.push(
    '  ' +
    col('#', 4) +
    col('Repo', repoColW) +
    col('Billed min', 12, true) +
    col('%', 8, true) +
    col('Dominant OS', 14),
  );
  const topRepos = byRepo.slice(0, 20);
  for (let i = 0; i < topRepos.length; i++) {
    const row = topRepos[i];
    lines.push(
      '  ' +
      col(i + 1, 4) +
      col(row.repo, repoColW) +
      col(row.billedMinutes, 12, true) +
      col(pct(row.billedMinutes, totalBilledMinutes), 8, true) +
      '  ' + (row.dominantOs ?? '-'),
    );
  }
  lines.push('');

  // ── By Workflow ───────────────────────────────────────
  if (byWorkflow.length > 0) {
    lines.push(sectionHeader('By Workflow'));
    const wfColW = 40;
    lines.push('  ' + col('#', 4) + col('Repo / Workflow', wfColW) + col('Billed min', 12, true));
    const topWf = byWorkflow.slice(0, 20);
    for (let i = 0; i < topWf.length; i++) {
      const row = topWf[i];
      const label = `${row.repo} / ${row.workflowName}`;
      lines.push('  ' + col(i + 1, 4) + col(label, wfColW) + col(Math.round(row.billedMinutes), 12, true));
    }
    lines.push('');
  }

  // ── By Job ────────────────────────────────────────────
  if (byJob.length > 0) {
    lines.push(sectionHeader('By Job'));
    const jobColW = 50;
    lines.push('  ' + col('#', 4) + col('Repo / Workflow / Job', jobColW) + col('Billed min', 12, true));
    const topJobs = byJob.slice(0, 20);
    for (let i = 0; i < topJobs.length; i++) {
      const row = topJobs[i];
      const label = `${row.repo} / ${row.workflowName} / ${row.jobName}`;
      lines.push('  ' + col(i + 1, 4) + col(label, jobColW) + col(Math.round(row.billedMinutes), 12, true));
    }
    lines.push('');
  }

  // ── Reconciliation ────────────────────────────────────
  if (reconciliation.length > 0) {
    lines.push(sectionHeader('Reconciliation (billing vs timing estimate)'));
    const recRepoColW = 30;
    lines.push(
      '  ' +
      col('Repo', recRepoColW) +
      col('Billing', 10, true) +
      col('Timing', 10, true) +
      col('Ratio', 8, true),
    );
    for (const row of reconciliation) {
      const flag = row.ratio < 0.8 || row.ratio > 1.2
        ? '  ⚠ (non-default runner?)'
        : '  ✓';
      lines.push(
        '  ' +
        col(row.repo, recRepoColW) +
        col(row.billingMinutes, 10, true) +
        col(row.timingMinutes, 10, true) +
        col(row.ratio.toFixed(2), 8, true) +
        flag,
      );
    }
    lines.push('');
  }

  // ── Footer ────────────────────────────────────────────
  lines.push(ruler('─'));
  lines.push('  Rate limit remaining: shown by CLI (fetched separately)');
  lines.push('  Run with --json for machine-readable output.');

  return lines.join('\n');
}
