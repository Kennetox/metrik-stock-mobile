export type ApiClientConfig = {
  getBaseUrl: () => string;
  getToken: () => string | null;
  onUnauthorized?: () => void;
  onDeviceBlocked?: (reason?: string) => void;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function toApiDetailMessage(detail: unknown, status: number): string {
  if (typeof detail === 'string' && detail.trim()) {
    return detail.trim();
  }
  if (Array.isArray(detail)) {
    const firstMessage = detail.find(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        'msg' in entry &&
        typeof (entry as { msg?: unknown }).msg === 'string',
    ) as { msg: string } | undefined;
    if (firstMessage?.msg?.trim()) {
      return firstMessage.msg.trim();
    }
  }
  if (detail && typeof detail === 'object') {
    const obj = detail as { message?: unknown; error?: unknown; detail?: unknown };
    if (typeof obj.message === 'string' && obj.message.trim()) {
      return obj.message.trim();
    }
    if (typeof obj.error === 'string' && obj.error.trim()) {
      return obj.error.trim();
    }
    if (typeof obj.detail === 'string' && obj.detail.trim()) {
      return obj.detail.trim();
    }
  }
  return `Error ${status}`;
}

function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function isDeviceBlockedMessage(status: number, message: string): boolean {
  if (status !== 422 && status !== 403) return false;
  const normalized = normalizeForMatch(message);
  if (!normalized.includes('dispositivo de inventario')) return false;
  return normalized.includes('inactivo') || normalized.includes('no existe');
}

function getApiDetailCode(detail: unknown): string | null {
  if (!detail || typeof detail !== 'object') return null;
  const code = (detail as { code?: unknown }).code;
  if (typeof code !== 'string' || !code.trim()) return null;
  return code.trim().toUpperCase();
}

export function createApiClient(config: ApiClientConfig) {
  async function request<T>(
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const base = config.getBaseUrl().replace(/\/$/, '');
    const url = `${base}${path}`;
    const token = config.getToken();
    const headers = new Headers(init?.headers ?? {});

    if (!headers.has('Content-Type') && init?.body && !(init.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const res = await fetch(url, {
      ...init,
      headers,
    });

    if (!res.ok) {
      const detail = await res
        .json()
        .then((payload) => payload?.detail)
        .catch(() => null);
      const message = toApiDetailMessage(detail, res.status);
      const detailCode = getApiDetailCode(detail);
      if (res.status === 401 && token) {
        config.onUnauthorized?.();
      }
      const isDeviceBlockedCode =
        detailCode === 'DEVICE_BLOCKED' || detailCode === 'DEVICE_NOT_ALLOWED';
      if (token && (isDeviceBlockedCode || isDeviceBlockedMessage(res.status, message))) {
        config.onDeviceBlocked?.(message);
      }
      throw new ApiError(message, res.status);
    }

    if (res.status === 204) {
      return undefined as T;
    }

    return (await res.json()) as T;
  }

  return {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body?: unknown, init?: RequestInit) =>
      request<T>(path, {
        ...init,
        method: 'POST',
        body: body
          ? body instanceof FormData
            ? body
            : JSON.stringify(body)
          : undefined,
      }),
    patch: <T>(path: string, body?: unknown, init?: RequestInit) =>
      request<T>(path, {
        ...init,
        method: 'PATCH',
        body: body
          ? body instanceof FormData
            ? body
            : JSON.stringify(body)
          : undefined,
      }),
    put: <T>(path: string, body?: unknown, init?: RequestInit) =>
      request<T>(path, {
        ...init,
        method: 'PUT',
        body: body
          ? body instanceof FormData
            ? body
            : JSON.stringify(body)
          : undefined,
      }),
    del: <T>(path: string) =>
      request<T>(path, {
        method: 'DELETE',
      }),
  };
}
