import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type SessionDetail } from '../lib/api';
import { useSSE } from './useSSE';

/**
 * Live session state. Pulls the active session over REST, then re-pulls on any
 * SSE event (events are intentionally coarse — "something changed, resync").
 */
export function useSession(onEvent?: (event: { type: string } & Record<string, unknown>) => void) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const d = await api.active();
      setDetail(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useSSE(
    useCallback(
      (event) => {
        if (event.type === 'hello') return;
        onEventRef.current?.(event);
        refresh();
      },
      [refresh],
    ),
  );

  return { detail, error, loading, refresh };
}
