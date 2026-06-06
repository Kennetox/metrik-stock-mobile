import type { ReturnTypeCreateApiClient } from './types';

export type ProductGroup = {
  id: number;
  path: string;
  display_name: string;
  parent_path?: string | null;
  image_url?: string | null;
  image_thumb_url?: string | null;
  tile_color?: string | null;
};

export type Product = {
  id: number;
  sku?: string | null;
  name: string;
  price: number;
  cost: number;
  barcode?: string | null;
  label_format?: string | null;
  unit?: string | null;
  stock_min: number;
  preferred_qty: number;
  reorder_point: number;
  low_stock_alert: boolean;
  allow_price_change: boolean;
  active: boolean;
  service: boolean;
  includes_tax: boolean;
  is_investment: boolean;
  group_name?: string | null;
  brand?: string | null;
  supplier?: string | null;
  web_name?: string | null;
  image_url?: string | null;
  image_thumb_url?: string | null;
  group_meta?: ProductGroup | null;
  qty_on_hand?: number | null;
};

export type ProductListOptions = {
  skip?: number;
  limit?: number;
};

export type ProductUpsertPayload = {
  sku?: string | null;
  name: string;
  price: number;
  cost: number;
  barcode?: string | null;
  label_format?: string | null;
  unit?: string | null;
  stock_min?: number;
  preferred_qty?: number;
  reorder_point?: number;
  low_stock_alert?: boolean;
  allow_price_change?: boolean;
  active?: boolean;
  service?: boolean;
  includes_tax?: boolean;
  is_investment?: boolean;
  group_name?: string | null;
  brand?: string | null;
  supplier?: string | null;
  auto_generate_codes?: boolean;
};

export type ProductDuplicateCandidate = {
  product_id: number;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  price: number;
  group_name?: string | null;
  brand?: string | null;
  supplier?: string | null;
  similarity_score: number;
  risk_level: 'alto' | 'medio' | 'bajo';
  match_reasons: string[];
};

export type ProductDuplicateCandidatesResponse = {
  candidates: ProductDuplicateCandidate[];
  has_high_risk: boolean;
};

export type ProductCostSuggestionRequest = {
  mode?: 'balanced' | 'conservative' | 'aggressive';
  price: number;
  group_name?: string | null;
  brand?: string | null;
  supplier?: string | null;
  exclude_product_id?: number | null;
};

export type ProductCostSuggestionResponse = {
  mode: 'balanced' | 'conservative' | 'aggressive';
  mode_label?: string | null;
  suggested_cost: number;
  range_min_cost: number;
  range_max_cost: number;
  confidence_score: number;
  confidence_label: 'alta' | 'media' | 'baja';
  method: string;
  method_label?: string | null;
  sample_size: number;
  markup_used: number;
  markup_p25: number;
  markup_p50: number;
  markup_p75: number;
  selected_markup_percent: number;
  recency_half_life_days: number;
  notes?: string | null;
};

export async function listProducts(
  client: ReturnTypeCreateApiClient,
  options?: ProductListOptions,
): Promise<Product[]> {
  const params = new URLSearchParams();
  if (options?.skip != null) params.set('skip', String(options.skip));
  if (options?.limit != null) params.set('limit', String(options.limit));
  const query = params.toString();
  return client.get<Product[]>(`/products/${query ? `?${query}` : ''}`);
}

export async function getProduct(
  client: ReturnTypeCreateApiClient,
  productId: number,
): Promise<Product> {
  return client.get<Product>(`/products/${productId}`);
}

export async function createProduct(
  client: ReturnTypeCreateApiClient,
  payload: ProductUpsertPayload,
): Promise<Product> {
  return client.post<Product>('/products/', payload);
}

export async function updateProduct(
  client: ReturnTypeCreateApiClient,
  productId: number,
  payload: ProductUpsertPayload,
): Promise<Product> {
  return client.put<Product>(`/products/${productId}`, payload);
}

export async function deleteProduct(
  client: ReturnTypeCreateApiClient,
  productId: number,
): Promise<void> {
  await client.del(`/products/${productId}`);
}

export async function listProductGroups(
  client: ReturnTypeCreateApiClient,
  options?: ProductListOptions,
): Promise<ProductGroup[]> {
  const params = new URLSearchParams();
  if (options?.skip != null) params.set('skip', String(options.skip));
  if (options?.limit != null) params.set('limit', String(options.limit));
  const query = params.toString();
  return client.get<ProductGroup[]>(`/product-groups/${query ? `?${query}` : ''}`);
}

export async function getProductDuplicateCandidates(
  client: ReturnTypeCreateApiClient,
  payload: {
    sku?: string | null;
    barcode?: string | null;
    name: string;
    group_name?: string | null;
    brand?: string | null;
    supplier?: string | null;
    limit?: number;
  },
): Promise<ProductDuplicateCandidatesResponse> {
  return client.post<ProductDuplicateCandidatesResponse>('/products/duplicate-candidates', payload);
}

export async function getProductCostSuggestion(
  client: ReturnTypeCreateApiClient,
  payload: ProductCostSuggestionRequest,
): Promise<ProductCostSuggestionResponse> {
  return client.post<ProductCostSuggestionResponse>('/products/cost-suggestion', payload);
}
