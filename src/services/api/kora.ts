import type { ReturnTypeCreateApiClient } from './types';

export type KoraRestockForecastItem = {
  product_id: number;
  product_name: string;
  sku?: string | null;
  price: number;
  units_today: number;
  qty_on_hand: number;
  coverage_days?: number | null;
  suggested_qty: number;
  urgency: 'high' | 'medium' | 'low';
};

export type KoraRestockForecastResponse = {
  generated_at: string;
  mode: 'general' | 'today';
  state: 'alert' | 'watch' | 'calm';
  horizon_days: number;
  lookback_days: number;
  headline: string;
  summary_lines: string[];
  items: KoraRestockForecastItem[];
};

export async function getRestockForecast(
  client: ReturnTypeCreateApiClient,
  options?: {
    mode?: 'general' | 'today';
    horizon_days?: number;
    lookback_days?: number;
  },
): Promise<KoraRestockForecastResponse> {
  const params = new URLSearchParams();
  params.set('mode', options?.mode ?? 'today');
  params.set('horizon_days', String(options?.horizon_days ?? 2));
  params.set('lookback_days', String(options?.lookback_days ?? 30));
  return client.get<KoraRestockForecastResponse>(`/kora/restock-forecast?${params.toString()}`);
}
