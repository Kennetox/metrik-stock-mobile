import type { ReturnTypeCreateApiClient } from './types';

type StockDevice = {
  id: string;
  name: string;
  is_active: boolean;
  bound_device_id?: string | null;
  bound_device_label?: string | null;
};

type StockDevicePage = {
  items: StockDevice[];
  total: number;
  skip: number;
  limit: number;
};

export async function listStockDevices(
  client: ReturnTypeCreateApiClient,
): Promise<StockDevicePage> {
  return client.get<StockDevicePage>('/stock/devices?skip=0&limit=200');
}

export async function createStockDevice(
  client: ReturnTypeCreateApiClient,
  payload: {
    name: string;
    bound_device_id?: string;
    bound_device_label?: string;
  },
): Promise<StockDevice> {
  return client.post<StockDevice>('/stock/devices', payload);
}

export async function updateStockDevice(
  client: ReturnTypeCreateApiClient,
  stockDeviceId: string,
  payload: {
    name?: string;
    is_active?: boolean;
    bound_device_id?: string;
    bound_device_label?: string;
    touch_seen?: boolean;
  },
): Promise<StockDevice> {
  return client.patch<StockDevice>(`/stock/devices/${stockDeviceId}`, payload);
}

export async function ensureStockDevice(
  client: ReturnTypeCreateApiClient,
  payload: {
    stock_device_id?: string | null;
    name: string;
    bound_device_id?: string;
    bound_device_label?: string;
  },
): Promise<StockDevice> {
  const normalizedName = payload.name.trim();
  if (!normalizedName) {
    throw new Error('El nombre del dispositivo es obligatorio.');
  }

  const boundDeviceId = payload.bound_device_id?.trim() || undefined;
  const boundDeviceLabel = payload.bound_device_label?.trim() || undefined;

  if (payload.stock_device_id?.trim()) {
    try {
      return await updateStockDevice(client, payload.stock_device_id.trim(), {
        name: normalizedName,
        bound_device_id: boundDeviceId,
        bound_device_label: boundDeviceLabel,
        touch_seen: true,
      });
    } catch {
      // If device no longer exists, fallback to lookup/create below.
    }
  }

  const page = await listStockDevices(client);
  const byName = page.items.find(
    (item) => item.name.trim().toLowerCase() === normalizedName.toLowerCase(),
  );
  if (byName) {
    return updateStockDevice(client, byName.id, {
      name: normalizedName,
      bound_device_id: boundDeviceId,
      bound_device_label: boundDeviceLabel,
      touch_seen: true,
    });
  }

  try {
    return await createStockDevice(client, {
      name: normalizedName,
      bound_device_id: boundDeviceId,
      bound_device_label: boundDeviceLabel,
    });
  } catch {
    // Concurrency-safe fallback in case another tablet created same name.
    const retryPage = await listStockDevices(client);
    const retryFound = retryPage.items.find(
      (item) => item.name.trim().toLowerCase() === normalizedName.toLowerCase(),
    );
    if (retryFound) {
      return updateStockDevice(client, retryFound.id, {
        touch_seen: true,
        bound_device_id: boundDeviceId,
        bound_device_label: boundDeviceLabel,
      });
    }
    throw new Error('No se pudo registrar el dispositivo de inventario.');
  }
}
