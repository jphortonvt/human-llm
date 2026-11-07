import { useEffect, useRef } from 'react';

/**
 * Subscribe to the server's /api/events SSE stream. Reconnects with backoff on
 * drop (EventSource does some of this natively; we add a state re-pull via the
 * onEvent callback so a reconnect always resyncs). See plan.md Phase 5.
 */
export function useSSE(onEvent: (event: { type: string } & Record<string, unknown>) => void) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    let retry = 1000;

    const connect = () => {
      if (closed) return;
      es = new EventSource('/api/events');
      es.onopen = () => {
        retry = 1000;
      };
      es.onmessage = (e) => {
        try {
          handlerRef.current(JSON.parse(e.data));
        } catch {
          /* ignore malformed frames */
        }
      };
      es.onerror = () => {
        es?.close();
        if (closed) return;
        retry = Math.min(retry * 1.5, 10000);
        setTimeout(connect, retry);
      };
    };
    connect();

    return () => {
      closed = true;
      es?.close();
    };
  }, []);
}
