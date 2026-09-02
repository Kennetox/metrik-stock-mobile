import type { RecountRecord } from './recounts';

export type KoraStockPlanStatus = 'ready' | 'converted' | 'completed' | 'expired' | 'cancelled';

export type KoraStockPlanItem = {
  id: number;
  product_id: number;
  product_name: string;
  sku?: string | null;
  barcode?: string | null;
  group_name?: string | null;
  system_qty: number;
  cost_impact: number;
  units_sold_lookback: number;
  priority_rank: number;
  reasons: string[];
};

export type KoraStockPlanContext = {
  scheduled_people?: number | null;
  scheduled_names: string[];
  reserved_for_sales: number;
  reserved_for_receiving: number;
  available_people?: number | null;
  open_receiving_count: number;
  sales_count_30m: number;
  workload_state: 'quiet' | 'normal' | 'busy' | 'unknown';
  automatic_plan_allowed: boolean;
  automatic_reason: string;
};

export type KoraStockPlan = {
  id: number;
  code: string;
  status: KoraStockPlanStatus;
  trigger: 'manual' | 'automatic';
  title: string;
  group_name?: string | null;
  requested_count: number;
  negative_sku_count: number;
  selected_count: number;
  total_negative_units: number;
  total_cost_impact: number;
  workload_state: 'quiet' | 'normal' | 'busy' | 'unknown';
  converted_recount_id?: number | null;
  created_at: string;
  expires_at?: string | null;
  context: KoraStockPlanContext;
  items: KoraStockPlanItem[];
};

export type KoraStockPlanResponse = {
  generated_at: string;
  state: 'ready' | 'existing' | 'not_eligible' | 'no_candidates' | 'none';
  message: string;
  plan?: KoraStockPlan | null;
};

export type KoraStockPlanConversion = {
  plan: KoraStockPlan;
  recount: RecountRecord;
};
