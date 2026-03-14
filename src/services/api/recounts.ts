import type { ReturnTypeCreateApiClient } from './types';
import type { RecountDetail, RecountPage, RecountRecord } from '../../types/recounts';

export async function listRecounts(
  client: ReturnTypeCreateApiClient,
  options?: {
    status?: 'draft' | 'counting' | 'closed' | 'applied' | 'cancelled';
    source?: 'web' | 'app';
    skip?: number;
    limit?: number;
  },
): Promise<RecountPage> {
  const params = new URLSearchParams();
  if (options?.status) params.set('status', options.status);
  if (options?.source) params.set('source', options.source);
  if (options?.skip != null) params.set('skip', String(options.skip));
  if (options?.limit != null) params.set('limit', String(options.limit));
  const query = params.toString();
  return client.get<RecountPage>(`/inventory/recounts${query ? `?${query}` : ''}`);
}

export async function createRecount(
  client: ReturnTypeCreateApiClient,
  payload: {
    source?: 'web' | 'app';
    stock_device_id?: string;
    title?: string;
    scope_type: 'all' | 'group' | 'free';
    scope_value?: string;
    count_mode?: 'blind' | 'visible';
    notes?: string;
  },
): Promise<RecountRecord> {
  return client.post<RecountRecord>('/inventory/recounts', payload);
}

export async function getRecountDetail(
  client: ReturnTypeCreateApiClient,
  recountId: number,
  options?: {
    q?: string;
    counted_only?: boolean;
    skip?: number;
    limit?: number;
  },
): Promise<RecountDetail> {
  const params = new URLSearchParams();
  if (options?.q) params.set('q', options.q);
  if (options?.counted_only) params.set('counted_only', 'true');
  if (options?.skip != null) params.set('skip', String(options.skip));
  if (options?.limit != null) params.set('limit', String(options.limit));
  const query = params.toString();
  return client.get<RecountDetail>(`/inventory/recounts/${recountId}${query ? `?${query}` : ''}`);
}

export async function upsertRecountLine(
  client: ReturnTypeCreateApiClient,
  recountId: number,
  payload: {
    product_id: number;
    counted_qty: number;
    notes?: string;
  },
) {
  return client.post(`/inventory/recounts/${recountId}/lines`, payload);
}

export async function clearRecountLine(
  client: ReturnTypeCreateApiClient,
  recountId: number,
  productId: number,
) {
  return client.del(`/inventory/recounts/${recountId}/lines/${productId}`);
}

export async function closeRecount(
  client: ReturnTypeCreateApiClient,
  recountId: number,
): Promise<RecountRecord> {
  return client.post<RecountRecord>(`/inventory/recounts/${recountId}/close`, {});
}

export async function applyRecount(
  client: ReturnTypeCreateApiClient,
  recountId: number,
): Promise<RecountRecord> {
  return client.post<RecountRecord>(`/inventory/recounts/${recountId}/apply`, {});
}

export async function cancelRecount(
  client: ReturnTypeCreateApiClient,
  recountId: number,
): Promise<RecountRecord> {
  return client.post<RecountRecord>(`/inventory/recounts/${recountId}/cancel`, {});
}
