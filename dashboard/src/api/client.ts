const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

/**
 * Custom error class that preserves HTTP status code for conditional handling.
 * E.g. the dashboard overview can silently ignore 404s from disabled modules.
 */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem('grc_admin_token');
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

/**
 * Force-logout: clear stored token and reload to show login screen.
 * Called when the API returns 401 (token expired / invalid).
 */
export function forceLogout() {
  localStorage.removeItem('grc_admin_token');
  localStorage.removeItem('grc_admin_refresh_token');
  window.location.reload();
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    // Auto-logout on 401 (expired / invalid token)
    if (res.status === 401) {
      forceLogout();
      // Never reached, but satisfies return type
      throw new Error('Session expired');
    }

    let message = `HTTP ${res.status}: ${res.statusText}`;
    try {
      const body = await res.json();
      message = body.detail ?? body.message ?? message;
    } catch {
      // ignore parse error
    }
    throw new ApiError(res.status, message);
  }
  const text = await res.text();
  if (!text) return undefined as unknown as T;
  return JSON.parse(text) as T;
}

function buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(`${BASE_URL}${path}`, window.location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString().replace(window.location.origin, '');
}

export async function get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const url = buildUrl(path, params);
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader(),
    },
  });
  return handleResponse<T>(res);
}

export async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(res);
}

export async function patch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(res);
}

export async function put<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(res);
}

export async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader(),
    },
  });
  return handleResponse<T>(res);
}

/**
 * POST with FormData (multipart/form-data).
 * Used for file uploads — do NOT set Content-Type header
 * (the browser sets it automatically with the boundary).
 */
export async function postFormData<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      ...getAuthHeader(),
    },
    body: formData,
  });
  return handleResponse<T>(res);
}

export const apiClient = { get, post, put, patch, del, postFormData };
