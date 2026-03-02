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
    return await client.post<LoginResponse>('/auth/tablet-login', payload);
  } catch (error) {
    // Backward compatibility: some production deployments may still expose only /auth/pos-login.
    if (error instanceof ApiError && error.status === 404) {
      return client.post<LoginResponse>('/auth/pos-login', payload);
    }
    throw error;
  }
}

export async function tabletEmailCheck(
  client: ReturnTypeCreateApiClient,
  payload: TabletEmailCheckPayload,
): Promise<TabletEmailCheckResponse> {
  return client.post<TabletEmailCheckResponse>('/auth/tablet-email-check', payload);
}
