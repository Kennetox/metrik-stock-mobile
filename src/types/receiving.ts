export type ReceivingLotStatus = 'open' | 'closed' | 'cancelled';
export type PurchaseType = 'invoice' | 'cash';

export type ReceivingLot = {
  id: number;
  lot_number: string;
  status: ReceivingLotStatus;
  purchase_type: PurchaseType;
  origin_name: string;
  stock_device_id?: string | null;
  stock_device_name?: string | null;
  source_reference?: string | null;
  supplier_name?: string | null;
  invoice_reference?: string | null;
  notes?: string | null;
  support_file_name?: string | null;
  support_file_url?: string | null;
  support_file_size?: number | null;
  created_by_user_id?: number | null;
  closed_by_user_id?: number | null;
  created_at: string;
  closed_at?: string | null;
};

export type ReceivingLotItem = {
  id: number;
  lot_id: number;
  product_id: number;
  product_name_snapshot: string;
  sku_snapshot?: string | null;
  barcode_snapshot?: string | null;
  qty_received: number;
  unit_cost_snapshot: number;
  unit_price_snapshot: number;
  is_new_product: boolean;
  notes?: string | null;
  created_at: string;
  updated_at: string;
};

export type LabelsSummary = {
  pending: number;
  printed: number;
  error: number;
};

export type ApiWarning = {
  code: string;
  message: string;
};

export type ReceivingLotDetail = {
  lot: ReceivingLot;
  items: ReceivingLotItem[];
  labels_summary: LabelsSummary;
  warnings: ApiWarning[];
};

export type ReceivingLotPage = {
  items: ReceivingLot[];
  total: number;
  skip: number;
  limit: number;
};

export type ReceivingDocument = {
  id: number;
  lot_number: string;
  status: ReceivingLotStatus;
  purchase_type: PurchaseType;
  origin_name: string;
  stock_device_id?: string | null;
  stock_device_name?: string | null;
  lines_count: number;
  units_total: number;
  created_at: string;
  closed_at?: string | null;
  closed_by_user_name?: string | null;
  supplier_name?: string | null;
  invoice_reference?: string | null;
  notes?: string | null;
  support_file_name?: string | null;
  support_file_url?: string | null;
  support_file_size?: number | null;
};

export type ReceivingDocumentPage = {
  items: ReceivingDocument[];
  total: number;
  skip: number;
  limit: number;
};

export type ReceivingCreatedProduct = {
  audit_id: number;
  product_id: number;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  price: number;
  cost: number;
  group_name?: string | null;
  created_at: string;
  created_by_user_name?: string | null;
};

export type ReceivingCreatedProductPage = {
  items: ReceivingCreatedProduct[];
  total: number;
  skip: number;
  limit: number;
};

export type ReceivingProductLookup = {
  id: number;
  sku?: string | null;
  barcode?: string | null;
  name: string;
  price: number;
  cost: number;
};
