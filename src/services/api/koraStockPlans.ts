import type {
  KoraStockPlanConversion,
  KoraStockPlanResponse,
} from '../../types/koraStockPlans';
import type { ReturnTypeCreateApiClient } from './types';

export async function getCurrentKoraStockPlan(
  client: ReturnTypeCreateApiClient,
): Promise<KoraStockPlanResponse> {
  return client.get<KoraStockPlanResponse>('/kora/stock-sanitization-plans/current');
}

export async function retrieveKoraStockPlan(
  client: ReturnTypeCreateApiClient,
  requestedCount = 15,
): Promise<KoraStockPlanResponse> {
  return client.post<KoraStockPlanResponse>('/kora/stock-sanitization-plans/retrieve', {
    requested_count: requestedCount,
    lookback_days: 30,
  });
}

export async function convertKoraStockPlan(
  client: ReturnTypeCreateApiClient,
  planId: number,
  stockDeviceId: string,
): Promise<KoraStockPlanConversion> {
  return client.post<KoraStockPlanConversion>(
    `/kora/stock-sanitization-plans/${planId}/convert`,
    {
      stock_device_id: stockDeviceId,
      count_mode: 'blind',
    },
  );
}
