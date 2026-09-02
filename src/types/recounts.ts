export type RecountStatus = 'draft' | 'counting' | 'closed' | 'applied' | 'cancelled';
export type RecountScope = 'all' | 'group' | 'free';
export type RecountMode = 'blind' | 'visible';

export type RecountSummary = {
  total_lines: number;
  counted_lines: number;
  pending_lines: number;
  difference_lines: number;
  total_system_qty: number;
  total_counted_qty: number;
  total_diff_qty: number;
};

export type RecountRecord = {
  id: number;
  code: string;
  status: RecountStatus;
  source: 'web' | 'app';
  stock_device_id?: string | null;
  stock_device_name?: string | null;
  scope_type: RecountScope;
  scope_value?: string | null;
  count_mode: RecountMode;
  title?: string | null;
  notes?: string | null;
  created_by_user_name?: string | null;
  closed_by_user_name?: string | null;
  applied_by_user_name?: string | null;
  created_at: string;
  started_at?: string | null;
  closed_at?: string | null;
  applied_at?: string | null;
  cancelled_at?: string | null;
  summary: RecountSummary;
};

export type RecountLine = {
  id: number;
  product_id: number;
  product_name: string;
  sku?: string | null;
  barcode?: string | null;
  group_name?: string | null;
  price?: number | null;
  last_movement_at?: string | null;
  system_qty: number;
  counted_qty?: number | null;
  diff_qty?: number | null;
  notes?: string | null;
  counted_at?: string | null;
};

export type RecountPage = {
  items: RecountRecord[];
  total: number;
  skip: number;
  limit: number;
};

export type RecountDetail = {
  recount: RecountRecord;
  lines: RecountLine[];
};
