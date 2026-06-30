import { reportClientError } from '../utils/clientLogger';

const API_BASE = '';

type BusyListener = () => void;

let pendingBackendRequests = 0;
const busyListeners = new Set<BusyListener>();

function emitBusyChange() {
  for (const listener of busyListeners) {
    listener();
  }
}

function beginBackendRequest() {
  pendingBackendRequests += 1;
  emitBusyChange();
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    pendingBackendRequests = Math.max(0, pendingBackendRequests - 1);
    emitBusyChange();
  };
}

export function subscribeBackendBusy(listener: BusyListener) {
  busyListeners.add(listener);
  return () => busyListeners.delete(listener);
}

export function getBackendBusySnapshot() {
  return pendingBackendRequests > 0;
}

function reportNetworkError(error: unknown, url: string, method: string) {
  reportClientError(error instanceof Error ? error.message : 'API network request failed', {
    stack: error instanceof Error ? error.stack : undefined,
    details: {
      type: 'api-network-error',
      url,
      method,
    },
  });
}

async function throwResponseError(response: Response, url: string, method: string): Promise<never> {
  let message = response.statusText;
  let requestId = response.headers.get('x-request-id');
  try {
    const data = await response.json();
    message = data.detail || message;
    if (!requestId && data.request_id) {
      requestId = data.request_id;
    }
  } catch {
    // Keep default message.
  }
  if (response.status >= 500) {
    const requestLabel = requestId ? ` request_id=${requestId}` : '';
    const serverMessage = `${message} (${method} ${url}, HTTP ${response.status}${requestLabel})`;
    reportClientError(typeof message === 'string' ? message : JSON.stringify(message), {
      details: {
        type: 'api-server-error',
        url,
        method,
        status: response.status,
        requestId,
      },
    });
    throw new Error(serverMessage);
  }
  throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const method = options?.method ?? 'GET';
  const finishBackendRequest = beginBackendRequest();
  try {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${url}`, options);
    } catch (error) {
      reportNetworkError(error, url, method);
      throw error;
    }

    if (!response.ok) {
      await throwResponseError(response, url, method);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return response.json() as Promise<T>;
  } finally {
    finishBackendRequest();
  }
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

function getFilenameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
  return filenameMatch?.[1] ?? null;
}

export async function downloadFile(url: string, fallbackFilename: string) {
  const finishBackendRequest = beginBackendRequest();
  try {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${url}`);
    } catch (error) {
      reportNetworkError(error, url, 'GET');
      throw error;
    }

    if (!response.ok) {
      await throwResponseError(response, url, 'GET');
    }

    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = getFilenameFromDisposition(response.headers.get('Content-Disposition')) ?? fallbackFilename;
    link.dataset.backendDownloadLink = 'true';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
  } finally {
    finishBackendRequest();
  }
}

export function mediaUrl(mediaId: number): string {
  return `/api/media/${mediaId}`;
}

export function crackImageUrl(recordId: number): string {
  return `/api/crack-records/${recordId}/image`;
}
