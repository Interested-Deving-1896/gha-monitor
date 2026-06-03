import { describe, it, expect } from 'vitest';
import { fetchBillingUsage } from './billing.js';
import type { OctokitClient } from './client.js';
import type { TimeWindow } from '../core/types.js';

const window: TimeWindow = {
  year: 2024,
  month: 3,
  sinceISO: '2024-03-01',
  daysInWindow: 31,
};

function makeFakeOctokit(behavior: 'success' | '404' | '403' | '500') {
  return {
    request: async (_: string, _params: unknown) => {
      if (behavior === 'success') {
        return {
          data: {
            usageItems: [
              {
                date: '2024-03-01',
                product: 'Actions',
                sku: 'Actions Linux',
                quantity: 60,
                unitType: 'minutes',
                pricePerUnit: 0.008,
                grossAmount: 0.48,
                discountAmount: 0,
                netAmount: 0.48,
                organizationName: 'myorg',
                repositoryName: 'repo1',
              },
              {
                date: '2024-03-01',
                product: 'Packages',
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
    },
  } as unknown as OctokitClient;
}

describe('fetchBillingUsage', () => {
  it('success: returns only Actions items with available: true', async () => {
    const result = await fetchBillingUsage(makeFakeOctokit('success'), 'myorg', window);

    expect(result.available).toBe(true);
    expect(result.items).toHaveLength(1);

    const item = result.items[0];
    expect(item.date).toBe('2024-03-01');
    expect(item.product).toBe('Actions');
    expect(item.sku).toBe('Actions Linux');
    expect(item.quantity).toBe(60);
    expect(item.unitType).toBe('minutes');
    expect(item.pricePerUnit).toBe(0.008);
    expect(item.grossAmount).toBe(0.48);
    expect(item.discountAmount).toBe(0);
    expect(item.netAmount).toBe(0.48);
    expect(item.organizationName).toBe('myorg');
    expect(item.repositoryName).toBe('repo1');
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
});
