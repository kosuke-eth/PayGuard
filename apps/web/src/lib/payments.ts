import { api } from './payguard-client';
import type { PaymentRecord } from './types';

export interface PaymentPage {
  records: PaymentRecord[];
  nextCursor: string | null;
}

/**
 * GET /v1/payments returns identity rows only; every displayed fact comes from the canonical
 * GET /v1/payments/{id} view of each row.
 */
export async function loadPaymentPage(
  params: { status?: string; cursor?: string; limit?: number } = {},
): Promise<PaymentPage> {
  const page = await api.listPayments(params);
  const records = await Promise.all(
    page.items.map(async (item) => ({
      ...(await api.getPayment(item.paymentId)),
      createdAt: item.createdAt,
    })),
  );
  return { records, nextCursor: page.nextCursor };
}
