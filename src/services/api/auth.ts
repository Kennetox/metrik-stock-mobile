import { ApiError } from './client';
import type { ReturnTypeCreateApiClient } from './types';

export type LoginPayload = {
  email: string;
  password: string;
};

export type TabletLoginPayload = {
  pin: string;
  stock_device_id?: string;
  email?: string;
  device_id?: string;
  device_label?: string;
};

export type TabletEmailCheckPayload = {
  station_id?: string;
  email: string;
};

export type LoginResponse = {
  access_token?: string;
  token?: string;
  token_type?: string;
  user?: {
    id: number;
    name: string;
    email?: string | null;
    role?: string | null;
  };
};

export type TabletEmailCheckResponse = {
  exists: boolean;
  user?: {
    id: number;
    name: string;
    email?: string | null;
    role?: string | null;
  };
};

export type MobileStockBindPayload = {
  setup_code: string;
  device_id?: string;
  device_label?: string;
};

export type MobileStockBindResponse = {
  stock_device_id: string;
  stock_device_name: string;
  tenant_id?: number | null;
  tenant_name?: string | null;
};

export async function login(
  client: ReturnTypeCreateApiClient,
  payload: LoginPayload,
): Promise<LoginResponse> {
  return client.post<LoginResponse>('/auth/login', payload);
}

export async function tabletLogin(
  client: ReturnTypeCreateApiClient,
  payload: TabletLoginPayload,
): Promise<LoginResponse> {
  try {
    return await client.post<LoginResponse>('/auth/mobile-stock-login', {
      stock_device_id: payload.stock_device_id,
      email: payload.email,
      pin: payload.pin,
      device_id: payload.device_id,
      device_label: payload.device_label,
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new ApiError(
        'El backend local no expone /auth/mobile-stock-login. Verifica que estés corriendo el proceso correcto de Kensar Backend.',
        404,
      );
    }
    throw error;
  }
}

export async function bindMobileStockDevice(
  client: ReturnTypeCreateApiClient,
  payload: MobileStockBindPayload,
): Promise<MobileStockBindResponse> {
  try {
    return await client.post<MobileStockBindResponse>('/auth/mobile-stock-bind', payload);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new ApiError(
        'El backend local no expone /auth/mobile-stock-bind. Verifica que estés corriendo el proceso correcto de Kensar Backend.',
        404,
      );
    }
    throw error;
  }
}

export async function tabletEmailCheck(
  client: ReturnTypeCreateApiClient,
  payload: TabletEmailCheckPayload,
): Promise<TabletEmailCheckResponse> {
  try {
    return await client.post<TabletEmailCheckResponse>('/auth/mobile-stock-email-check', {
      email: payload.email,
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new ApiError(
        'El backend local no expone /auth/mobile-stock-email-check. Verifica que estés corriendo el proceso correcto de Kensar Backend.',
        404,
      );
    }
    throw error;
  }
}
