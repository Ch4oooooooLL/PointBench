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

export class ApiError extends Error {
  success = false as const;
  level: 'error' | 'warning';
  status?: number;
  requestId: string | null;

  constructor(
    message: string,
    options: { level?: 'error' | 'warning'; status?: number; requestId?: string | null } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.level = options.level ?? 'error';
    this.status = options.status;
    this.requestId = options.requestId ?? null;
  }
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 90_000;
let requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS;

export function setRequestTimeoutMs(ms: number) {
  requestTimeoutMs = Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_REQUEST_TIMEOUT_MS;
}

export interface ApiRequestOptions extends RequestInit {
  timeoutMs?: number;
}

function createTimeoutAbort(timeoutMs: number, externalSignal?: AbortSignal | null) {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }
  return {
    signal: controller.signal,
    isTimedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timeoutId);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    },
  };
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
    throw new ApiError(serverMessage, { status: response.status, requestId });
  }
  throw new ApiError(typeof message === 'string' ? message : JSON.stringify(message), {
    status: response.status,
    requestId,
  });
}

async function request<T>(url: string, options?: ApiRequestOptions): Promise<T> {
  const method = options?.method ?? 'GET';
  const timeoutMs = options?.timeoutMs ?? requestTimeoutMs;
  const finishBackendRequest = beginBackendRequest();
  const timeout = createTimeoutAbort(timeoutMs, options?.signal);
  try {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${url}`, { ...options, signal: timeout.signal });
    } catch (error) {
      reportNetworkError(error, url, method);
      if (timeout.isTimedOut()) {
        throw new ApiError(`请求超时（${Math.round(timeoutMs / 1000)} 秒）：后端长时间未响应，请稍后重试。`);
      }
      throw new ApiError(error instanceof Error ? error.message : '网络请求失败，请检查网络连接。');
    }

    if (!response.ok) {
      await throwResponseError(response, url, method);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      throw new ApiError(`后端返回了非 JSON 响应（HTTP ${response.status}），请稍后重试。`);
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError(`后端返回了空的或非法的 JSON 数据（HTTP ${response.status}），请稍后重试。`);
    }
  } finally {
    timeout.dispose();
    finishBackendRequest();
  }
}

export const api = {
  get: <T>(url: string, options?: ApiRequestOptions) => request<T>(url, options),
  post: <T>(url: string, body?: unknown, options?: ApiRequestOptions) =>
    request<T>(url, {
      method: 'POST',
      headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
      body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
      ...options,
    }),
  put: <T>(url: string, body: unknown, options?: ApiRequestOptions) =>
    request<T>(url, {
      method: 'PUT',
      headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
      body: body instanceof FormData ? body : JSON.stringify(body),
      ...options,
    }),
  delete: <T>(url: string, options?: ApiRequestOptions) => request<T>(url, { ...options, method: 'DELETE' }),
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
  const timeout = createTimeoutAbort(requestTimeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${url}`, { signal: timeout.signal });
    } catch (error) {
      reportNetworkError(error, url, 'GET');
      if (timeout.isTimedOut()) {
        throw new ApiError(`下载超时（${Math.round(requestTimeoutMs / 1000)} 秒）：后端长时间未响应，请稍后重试。`);
      }
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
    timeout.dispose();
    finishBackendRequest();
  }
}

export function mediaUrl(mediaId: number): string {
  return `/api/media/${mediaId}`;
}

export function crackImageUrl(recordId: number): string {
  return `/api/crack-records/${recordId}/image`;
}
