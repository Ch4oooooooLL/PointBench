import { useEffect, useSyncExternalStore } from 'react';
import { getBackendBusySnapshot, subscribeBackendBusy } from '../api/client';

const blockedMouseEvents = [
  'click',
  'contextmenu',
  'dblclick',
  'dragstart',
  'drop',
  'mousedown',
  'mousemove',
  'mouseup',
  'pointerdown',
  'pointermove',
  'pointerup',
  'wheel',
];

export function BackendBusyGuard() {
  const isBackendBusy = useSyncExternalStore(
    subscribeBackendBusy,
    getBackendBusySnapshot,
    getBackendBusySnapshot,
  );

  useEffect(() => {
    if (!isBackendBusy) return undefined;

    const blockMouseEvent = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-backend-download-link="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    for (const eventName of blockedMouseEvents) {
      window.addEventListener(eventName, blockMouseEvent, { capture: true, passive: false });
    }

    return () => {
      for (const eventName of blockedMouseEvents) {
        window.removeEventListener(eventName, blockMouseEvent, { capture: true });
      }
    };
  }, [isBackendBusy]);

  if (!isBackendBusy) return null;

  return (
    <div className="backend-busy-guard" aria-live="polite" aria-busy="true">
      <div className="backend-busy-indicator">
        <div className="chart-loading-spinner" />
        <span>后端处理中，请稍候…</span>
      </div>
    </div>
  );
}
