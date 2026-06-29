type ClientLogDetails = Record<string, unknown>;

interface ClientLogPayload {
  level?: 'debug' | 'info' | 'warning' | 'error' | 'critical';
  message: string;
  stack?: string;
  component_stack?: string;
  source?: string;
  lineno?: number;
  colno?: number;
  url?: string;
  user_agent?: string;
  details?: ClientLogDetails;
}

let isReporting = false;

function normalizeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  if (typeof error === 'string') {
    return { message: error };
  }
  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: String(error) };
  }
}

export function reportClientError(message: string, details: Partial<ClientLogPayload> = {}) {
  if (isReporting) return;
  isReporting = true;

  const payload: ClientLogPayload = {
    level: details.level ?? 'error',
    message,
    stack: details.stack,
    component_stack: details.component_stack,
    source: details.source,
    lineno: details.lineno,
    colno: details.colno,
    url: details.url ?? window.location.href,
    user_agent: navigator.userAgent,
    details: details.details,
  };

  fetch('/api/client-logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  })
    .catch(() => undefined)
    .finally(() => {
      isReporting = false;
    });
}

export function installClientErrorHandlers() {
  window.addEventListener('error', (event) => {
    reportClientError(event.message || 'Unhandled browser error', {
      stack: event.error instanceof Error ? event.error.stack : undefined,
      source: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      details: { type: 'window.error' },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const normalized = normalizeError(event.reason);
    reportClientError(normalized.message || 'Unhandled promise rejection', {
      stack: normalized.stack,
      details: { type: 'unhandledrejection' },
    });
  });
}
