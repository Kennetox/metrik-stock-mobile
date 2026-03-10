import { ApiError } from './client';
import type { ReturnTypeCreateApiClient } from './types';

export type LoginPayload = {
  email: string;
  password: string;
};

export type TabletLoginPayload = {
  station_id: string;
  pin: string;
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
      email: payload.email,
      pin: payload.pin,
      device_id: payload.device_id,
      device_label: payload.device_label,
    });
  } catch (error) {
    // Backward compatibility: some deployments may still expose only tablet/pos routes.
    if (error instanceof ApiError && error.status === 404) {
      if (!payload.station_id) {
        throw new ApiError(
          'El backend no tiene login de Metrik Stock activo y falta station_id de compatibilidad.',
          400,
        );
      }
      try {
        return await client.post<LoginResponse>('/auth/tablet-login', payload);
      } catch (tabletError) {
        if (tabletError instanceof ApiError && tabletError.status === 404) {
          return client.post<LoginResponse>('/auth/pos-login', payload);
        }
        throw tabletError;
      }
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
    // Backward compatibility for older backends that still use tablet endpoint.
    if (error instanceof ApiError && error.status === 404) {
      if (!payload.station_id) {
        throw new ApiError(
          'El backend no tiene validación de correo para Metrik Stock activa y falta station_id de compatibilidad.',
          400,
        );
      }
      return client.post<TabletEmailCheckResponse>('/auth/tablet-email-check', {
        station_id: payload.station_id,
        email: payload.email,
      });
    }
    throw error;
  }
}
