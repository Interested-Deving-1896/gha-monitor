import type { OctokitClient } from './client.js';
import type { LineItem, TimeWindow } from '../core/types.js';

export interface BillingResult {
  items: LineItem[];
  available: boolean;
}

export async function fetchBillingUsage(
  octokit: OctokitClient,
  org: string,
  window: TimeWindow,
): Promise<BillingResult> {
  try {
    // Intentionally omit 'day' — the billing API with day=D returns MTD (day 1 to D),
    // not a rolling window. We fetch the full month and filter client-side by date range.
    const response = await octokit.request(
      'GET /organizations/{org}/settings/billing/usage',
      {
        org,
        year: window.year,
        month: window.month,
      },
    );

    const usageItems = (response.data as { usageItems: LineItem[] }).usageItems;

    const sinceDate = window.sinceISO;        // "YYYY-MM-DD"
    const untilDate = window.untilISO;        // "YYYY-MM-DD" or undefined

    const items: LineItem[] = usageItems
      .filter((item) => {
        // The real GitHub API returns lowercase product names (e.g. "actions", not "Actions")
        if (String(item.product).toLowerCase() !== 'actions') return false;
        // The real API returns full ISO timestamps (e.g. "2026-06-01T00:30:45Z"), not bare
        // YYYY-MM-DD strings. Slice to 10 chars before comparing against sinceISO/untilISO.
        const itemDate = String(item.date).slice(0, 10);
        if (itemDate < sinceDate) return false;
        if (untilDate && itemDate > untilDate) return false;
        return true;
      })
      .map((item) => ({
        // Normalize the stored date to YYYY-MM-DD (strips any time component/timezone)
        date: String(item.date).slice(0, 10),
        product: item.product,
        sku: item.sku,
        quantity: item.quantity,
        unitType: item.unitType,
        pricePerUnit: item.pricePerUnit,
        grossAmount: item.grossAmount,
        discountAmount: item.discountAmount,
        netAmount: item.netAmount,
        organizationName: item.organizationName,
        repositoryName: item.repositoryName,
      }));

    return { items, available: true };
  } catch (error) {
    const status = (error as { status?: number }).status;

    if (status === 404 || status === 403) {
      console.warn(
        `[gha-monitor] Enhanced billing API returned ${status} for org "${org}". ` +
          `This org may not be on the enhanced billing platform, or the token ` +
          `is missing the "manage_billing:org" scope. Billing data will not be available.`,
      );
      return { items: [], available: false };
    }

    if (status === 400) {
      throw new Error(`Billing API returned 400 Bad Request — check that year/month parameters are valid (year=${window.year}, month=${window.month})`);
    }

    throw error;
  }
}
