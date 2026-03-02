export type ApiClientConfig = {
  getBaseUrl: () => string;
  getToken: () => string | null;
  onUnauthorized?: () => void;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
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
      if (res.status === 401 && token) {
        config.onUnauthorized?.();
      }
      throw new ApiError(detail ?? `Error ${res.status}`, res.status);
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
    del: <T>(path: string) =>
      request<T>(path, {
        method: 'DELETE',
      }),
  };
}
