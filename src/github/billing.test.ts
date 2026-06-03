import { describe, it, expect, vi } from 'vitest';
import { fetchBillingUsage } from './billing.js';
import type { OctokitClient } from './client.js';
import type { TimeWindow } from '../core/types.js';

const window: TimeWindow = {
  year: 2024,
  month: 3,
  sinceISO: '2024-03-01',
  daysInWindow: 31,
};

function makeFakeOctokit(behavior: 'success' | '404' | '403' | '500', spy?: ReturnType<typeof vi.fn>) {
  return {
    request: spy ?? (async (_: string, _params: unknown) => {
      if (behavior === 'success') {
        return {
          data: {
            // Real GitHub API returns lowercase product names and full ISO timestamps
            usageItems: [
              {
                date: '2024-03-01T00:30:45Z',
                product: 'actions',
                sku: 'Actions Linux',
                quantity: 60,
                unitType: 'Minutes',
                pricePerUnit: 0.008,
                grossAmount: 0.48,
                discountAmount: 0,
                netAmount: 0.48,
                organizationName: 'myorg',
                repositoryName: 'repo1',
              },
              {
                date: '2024-03-01T00:30:45Z',
                product: 'packages',
                sku: 'Packages Storage',
                quantity: 5,
                unitType: 'GB',
                pricePerUnit: 0.25,
                grossAmount: 1.25,
                discountAmount: 0,
                netAmount: 1.25,
                organizationName: 'myorg',
                repositoryName: 'repo2',
              },
            ],
          },
        };
      }
      const status = behavior === '404' ? 404 : behavior === '403' ? 403 : 500;
      const err = Object.assign(new Error(`HTTP ${status}`), { status });
      throw err;
    }),
  } as unknown as OctokitClient;
}

function makeMultiDayOctokit(items: { date: string; product: string; quantity: number }[]) {
  return {
    request: async () => ({
      data: {
        usageItems: items.map((i) => ({
          ...i,
          sku: 'Actions Linux',
          unitType: 'minutes',
          pricePerUnit: 0.008,
          grossAmount: i.quantity * 0.008,
          discountAmount: 0,
          netAmount: i.quantity * 0.008,
          organizationName: 'myorg',
          repositoryName: 'repo1',
        })),
      },
    }),
  } as unknown as OctokitClient;
}

describe('fetchBillingUsage', () => {
  it('success: returns only Actions items with available: true', async () => {
    const result = await fetchBillingUsage(makeFakeOctokit('success'), 'myorg', window);

    expect(result.available).toBe(true);
    expect(result.items).toHaveLength(1);

    const item = result.items[0];
    expect(item.date).toBe('2024-03-01');       // stored as normalized YYYY-MM-DD
    expect(item.product).toBe('actions');        // stored as-received (lowercase)
    expect(item.sku).toBe('Actions Linux');
    expect(item.quantity).toBe(60);
    expect(item.unitType).toBe('Minutes');  // real API returns capital M
    expect(item.pricePerUnit).toBe(0.008);
    expect(item.grossAmount).toBe(0.48);
    expect(item.discountAmount).toBe(0);
    expect(item.netAmount).toBe(0.48);
    expect(item.organizationName).toBe('myorg');
    expect(item.repositoryName).toBe('repo1');
  });

  it('does not pass the day param to the API (avoids MTD mismatch)', async () => {
    const spy = vi.fn().mockResolvedValue({ data: { usageItems: [] } });
    const octokit = { request: spy } as unknown as OctokitClient;
    const rollingWindow: TimeWindow = {
      year: 2024,
      month: 6,
      day: 15,
      sinceISO: '2024-06-09',
      untilISO: '2024-06-15',
      daysInWindow: 7,
    };

    await fetchBillingUsage(octokit, 'myorg', rollingWindow);

    expect(spy).toHaveBeenCalledOnce();
    const params = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(params).not.toHaveProperty('day');
    expect(params.year).toBe(2024);
    expect(params.month).toBe(6);
  });

  it('filters items client-side to sinceISO..untilISO range', async () => {
    const rollingWindow: TimeWindow = {
      year: 2024,
      month: 6,
      day: 15,
      sinceISO: '2024-06-09',
      untilISO: '2024-06-15',
      daysInWindow: 7,
    };

    // Real API returns full ISO timestamps (not bare YYYY-MM-DD) and lowercase product names
    const octokit = makeMultiDayOctokit([
      { date: '2024-06-01T23:59:00Z', product: 'actions', quantity: 10 }, // before sinceISO — excluded
      { date: '2024-06-09T00:00:01Z', product: 'actions', quantity: 20 }, // == sinceISO — included
      { date: '2024-06-12T12:00:00Z', product: 'actions', quantity: 30 }, // in range — included
      { date: '2024-06-15T23:30:00Z', product: 'actions', quantity: 40 }, // == untilISO boundary — included
      { date: '2024-06-16T00:00:00Z', product: 'actions', quantity: 50 }, // after untilISO — excluded
    ]);

    const result = await fetchBillingUsage(octokit, 'myorg', rollingWindow);

    expect(result.available).toBe(true);
    expect(result.items).toHaveLength(3);
    // dates are normalized to YYYY-MM-DD when stored
    expect(result.items.map((i) => i.date)).toEqual(['2024-06-09', '2024-06-12', '2024-06-15']);
    expect(result.items.reduce((s, i) => s + i.quantity, 0)).toBe(90);
  });

  it('404: returns { items: [], available: false } without throwing', async () => {
    const result = await fetchBillingUsage(makeFakeOctokit('404'), 'myorg', window);

    expect(result.available).toBe(false);
    expect(result.items).toHaveLength(0);
  });

  it('403: returns { items: [], available: false } without throwing', async () => {
    const result = await fetchBillingUsage(makeFakeOctokit('403'), 'myorg', window);

    expect(result.available).toBe(false);
    expect(result.items).toHaveLength(0);
  });

  it('500: rethrows the error', async () => {
    await expect(
      fetchBillingUsage(makeFakeOctokit('500'), 'myorg', window),
    ).rejects.toMatchObject({ status: 500 });
  });

  it('regression: real API shape — lowercase product + ISO timestamp dates are not silently dropped', async () => {
    // Reproduces the exact ResonantIQ bug: API returns `product: "actions"` (lowercase)
    // and `date: "2026-06-02T03:57:39Z"` (full ISO timestamp). The old filter dropped
    // everything because it checked `product !== 'Actions'` and used raw timestamp in
    // a lexicographic date comparison against a bare YYYY-MM-DD untilISO.
    const rollingWindow: TimeWindow = {
      year: 2026,
      month: 6,
      day: 2,
      sinceISO: '2026-05-27',
      untilISO: '2026-06-02',
      daysInWindow: 7,
    };

    const octokit = makeMultiDayOctokit([
      { date: '2026-06-01T00:30:45Z', product: 'actions', quantity: 282 }, // in range
      { date: '2026-06-02T03:57:39Z', product: 'actions', quantity: 548 }, // == untilISO day
      { date: '2026-06-03T01:14:31Z', product: 'actions', quantity: 99 },  // after untilISO — excluded
    ]);

    const result = await fetchBillingUsage(octokit, 'ResonantIQ', rollingWindow);

    expect(result.available).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.items.reduce((s, i) => s + i.quantity, 0)).toBe(830);
  });
});
