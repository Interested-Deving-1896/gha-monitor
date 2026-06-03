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
    const response = await octokit.request(
      'GET /organizations/{org}/settings/billing/usage',
      {
        org,
        year: window.year,
        month: window.month,
        ...(window.day !== undefined ? { day: window.day } : {}),
      },
    );

    const usageItems = (response.data as { usageItems: LineItem[] }).usageItems;

    const items: LineItem[] = usageItems
      .filter((item) => item.product === 'Actions')
      .map((item) => ({
        date: item.date,
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

    throw error;
  }
}
