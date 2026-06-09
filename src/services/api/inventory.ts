import type { ReturnTypeCreateApiClient } from './types';

export type InventoryProductRow = {
  product_id: number;
  product_name: string;
  sku?: string | null;
  barcode?: string | null;
  group_name?: string | null;
  qty_on_hand: number;
  status: 'ok' | 'low' | 'critical';
  cost: number;
  price: number;
  last_movement_at?: string | null;
};

export type InventoryProductPage = {
  items: InventoryProductRow[];
  total: number;
  skip: number;
  limit: number;
  total_cost_value: number;
  total_price_value: number;
};

export type InventorySortOption =
  | 'name_asc'
  | 'stock_asc'
  | 'stock_desc'
  | 'sku_asc'
  | 'sku_desc'
  | 'cost_stock_asc'
  | 'cost_stock_desc'
  | 'price_stock_asc'
  | 'price_stock_desc';

export async function listInventoryProducts(
  client: ReturnTypeCreateApiClient,
  options?: {
    skip?: number;
    limit?: number;
    search?: string;
    group?: string;
    stock?: 'all' | 'positive' | 'zero' | 'negative';
    status?: 'all' | 'ok' | 'low' | 'critical' | 'negative';
    sort?: InventorySortOption;
  },
): Promise<InventoryProductPage> {
  const params = new URLSearchParams();
  if (options?.skip != null) params.set('skip', String(options.skip));
  if (options?.limit != null) params.set('limit', String(options.limit));
  if (options?.search) params.set('search', options.search);
  if (options?.group) params.set('group', options.group);
  if (options?.stock && options.stock !== 'all') params.set('stock', options.stock);
  if (options?.status && options.status !== 'all') params.set('status', options.status);
  if (options?.sort) params.set('sort', options.sort);
  const query = params.toString();
  return client.get<InventoryProductPage>(`/inventory/products${query ? `?${query}` : ''}`);
}
