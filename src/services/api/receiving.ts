import type {
  ReceivingCreatedProductPage,
  ReceivingDocumentPage,
  ReceivingLotDetail,
  ReceivingLotPage,
  ReceivingProductLookup,
  PurchaseType,
} from '../../types/receiving';
import type { ReturnTypeCreateApiClient } from './types';

export type CreateLotPayload = {
  purchase_type: PurchaseType;
  origin_name: string;
  source_reference?: string;
  supplier_name?: string;
  invoice_reference?: string;
  notes?: string;
};

export async function listLots(
  client: ReturnTypeCreateApiClient,
  options?: {
    status?: 'open' | 'closed' | 'cancelled';
    skip?: number;
    limit?: number;
  },
): Promise<ReceivingLotPage> {
  const params = new URLSearchParams();
  if (options?.status) params.set('status', options.status);
  if (options?.skip != null) params.set('skip', String(options.skip));
  if (options?.limit != null) params.set('limit', String(options.limit));
  const query = params.toString();
  return client.get<ReceivingLotPage>(`/receiving/lots${query ? `?${query}` : ''}`);
}

export async function createLot(
  client: ReturnTypeCreateApiClient,
  payload: CreateLotPayload,
): Promise<{ id: number; lot_number: string }> {
  return client.post<{ id: number; lot_number: string }>('/receiving/lots', payload);
}

export async function getLotDetail(
  client: ReturnTypeCreateApiClient,
  lotId: number,
): Promise<ReceivingLotDetail> {
  return client.get<ReceivingLotDetail>(`/receiving/lots/${lotId}`);
}

export async function searchReceivingProducts(
  client: ReturnTypeCreateApiClient,
  q: string,
  limit = 20,
): Promise<ReceivingProductLookup[]> {
  const params = new URLSearchParams();
  params.set('q', q);
  params.set('limit', String(limit));
  return client.get<ReceivingProductLookup[]>(`/receiving/products/search?${params.toString()}`);
}

export async function addReceivingLotItem(
  client: ReturnTypeCreateApiClient,
  lotId: number,
  payload: {
    product_id: number;
    qty_received: number;
    unit_cost?: number;
    notes?: string;
  },
): Promise<void> {
  await client.post(`/receiving/lots/${lotId}/items`, payload);
}

export async function updateReceivingLotItem(
  client: ReturnTypeCreateApiClient,
  lotId: number,
  itemId: number,
  payload: {
    qty_received: number;
    unit_cost?: number;
    notes?: string;
  },
): Promise<void> {
  await client.patch(`/receiving/lots/${lotId}/items/${itemId}`, payload);
}

export async function deleteReceivingLotItem(
  client: ReturnTypeCreateApiClient,
  lotId: number,
  itemId: number,
): Promise<void> {
  await client.del(`/receiving/lots/${lotId}/items/${itemId}`);
}

export async function closeReceivingLot(
  client: ReturnTypeCreateApiClient,
  lotId: number,
): Promise<void> {
  await client.post(`/receiving/lots/${lotId}/close`, {});
}

export async function updateReceivingLot(
  client: ReturnTypeCreateApiClient,
  lotId: number,
  payload: {
    purchase_type: PurchaseType;
    source_reference?: string;
    supplier_name?: string;
    invoice_reference?: string;
    notes?: string;
  },
): Promise<void> {
  await client.patch(`/receiving/lots/${lotId}`, payload);
}

export async function cancelReceivingLot(
  client: ReturnTypeCreateApiClient,
  lotId: number,
): Promise<void> {
  await client.post(`/receiving/lots/${lotId}/cancel`, {});
}

export async function getReceivingNextProductCodes(
  client: ReturnTypeCreateApiClient,
): Promise<{ sku: string; barcode: string }> {
  return client.get<{ sku: string; barcode: string }>('/receiving/products/next-codes');
}

export async function listReceivingProductGroups(
  client: ReturnTypeCreateApiClient,
  options?: {
    skip?: number;
    limit?: number;
  },
): Promise<Array<{ id: number; path: string; display_name: string }>> {
  const params = new URLSearchParams();
  if (options?.skip != null) params.set('skip', String(options.skip));
  if (options?.limit != null) params.set('limit', String(options.limit));
  const query = params.toString();
  const rows = await client.get<Array<{
    id: number;
    path: string;
    display_name: string;
    parent_path?: string | null;
  }>>(`/receiving/product-groups${query ? `?${query}` : ''}`);
  return rows;
}

export async function createReceivingProductQuick(
  client: ReturnTypeCreateApiClient,
  payload: {
    name: string;
    price: number;
    cost?: number;
    group_name: string;
    brand?: string;
    supplier?: string;
  },
): Promise<ReceivingProductLookup> {
  return client.post<ReceivingProductLookup>('/receiving/products/quick-create', {
    name: payload.name.trim(),
    price: payload.price,
    cost: payload.cost,
    group_name: payload.group_name,
    brand: payload.brand,
    supplier: payload.supplier,
  });
}

export async function uploadReceivingLotSupportFile(
  client: ReturnTypeCreateApiClient,
  lotId: number,
  file: {
    uri: string;
    name: string;
    type?: string;
  },
): Promise<void> {
  const form = new FormData();
  form.append('file', {
    uri: file.uri,
    name: file.name,
    type: file.type ?? 'application/octet-stream',
  } as any);
  await client.post(`/receiving/lots/${lotId}/support-file`, form, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
}

export async function listReceivingDocuments(
  client: ReturnTypeCreateApiClient,
  options?: {
    skip?: number;
    limit?: number;
    date_from?: string;
    date_to?: string;
  },
): Promise<ReceivingDocumentPage> {
  const params = new URLSearchParams();
  if (options?.skip != null) params.set('skip', String(options.skip));
  if (options?.limit != null) params.set('limit', String(options.limit));
  if (options?.date_from) params.set('date_from', options.date_from);
  if (options?.date_to) params.set('date_to', options.date_to);
  const query = params.toString();
  return client.get<ReceivingDocumentPage>(`/receiving/documents${query ? `?${query}` : ''}`);
}

export async function listReceivingCreatedProducts(
  client: ReturnTypeCreateApiClient,
  options?: {
    skip?: number;
    limit?: number;
  },
): Promise<ReceivingCreatedProductPage> {
  const params = new URLSearchParams();
  if (options?.skip != null) params.set('skip', String(options.skip));
  if (options?.limit != null) params.set('limit', String(options.limit));
  const query = params.toString();
  return client.get<ReceivingCreatedProductPage>(`/receiving/products/created${query ? `?${query}` : ''}`);
}
