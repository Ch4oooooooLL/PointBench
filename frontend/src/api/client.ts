import { reportClientError } from '../utils/clientLogger';

const API_BASE = '';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${url}`, options);
  } catch (error) {
    reportClientError(error instanceof Error ? error.message : 'API network request failed', {
      stack: error instanceof Error ? error.stack : undefined,
      details: {
        type: 'api-network-error',
        url,
        method: options?.method ?? 'GET',
      },
    });
    throw error;
  }

  if (!response.ok) {
    let message = response.statusText;
    try {
      const data = await response.json();
      message = data.detail || message;
    } catch {
      // Keep default message.
    }
    if (response.status >= 500) {
      reportClientError(typeof message === 'string' ? message : JSON.stringify(message), {
        details: {
          type: 'api-server-error',
          url,
          method: options?.method ?? 'GET',
          status: response.status,
          requestId: response.headers.get('x-request-id'),
        },
      });
    }
    throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body?: unknown) =>
    request<T>(url, {
      method: 'POST',
      headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
      body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
    }),
  put: <T>(url: string, body: unknown) =>
    request<T>(url, {
      method: 'PUT',
      headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),
  delete: <T>(url: string) => request<T>(url, { method: 'DELETE' }),
};

export function mediaUrl(mediaId: number): string {
  return `/api/media/${mediaId}`;
}

export function crackImageUrl(recordId: number): string {
  return `/api/crack-records/${recordId}/image`;
}
