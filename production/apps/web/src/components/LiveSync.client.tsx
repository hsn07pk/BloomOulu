'use client';
/**
 * Browser-side real-time sync. Opens a single SSE connection to the API
 * `/v1/events` channel and triggers `router.refresh()` whenever the
 * admin panel publishes a change. The result: any open tab (home,
 * adopt, plant detail, AskTheGarden, My Garden, kiosk) re-renders its
 * Server Components against fresh data within ~100 ms of an admin
 * clicking Save — no hard refresh required.
 *
 * Auto-reconnects with exponential backoff. Survives short network
 * blips and reverse-proxy idle timeouts (the API also sends a 15 s
 * heartbeat comment to keep the stream warm).
 *
 * Debounced: an admin "Save & continue editing" that fires three writes
 * in quick succession produces one router.refresh() at most, not three.
 */
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  /** Full API base URL (e.g. http://localhost:4000). Same value used
   *  for every other API fetch in the client bundle. */
  apiUrl: string;
}

export default function LiveSync({ apiUrl }: Props) {
  const router = useRouter();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let stopped = false;

    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = null;
        router.refresh();
      }, 250);
    };

    const connect = () => {
      if (stopped) return;
      const url = `${apiUrl.replace(/\/$/, '')}/v1/events`;
      try {
        es = new EventSource(url, { withCredentials: false });
      } catch {
        scheduleReconnect();
        return;
      }
      es.addEventListener('open', () => {
        attempt = 0;
      });
      const onChange = () => scheduleRefresh();
      es.addEventListener('admin.changed', onChange);
      es.addEventListener('settings.updated', onChange);
      es.addEventListener('plants.updated', onChange);
      es.addEventListener('tiers.updated', onChange);
      es.addEventListener('corpus.updated', onChange);
      es.addEventListener('error', () => {
        es?.close();
        es = null;
        scheduleReconnect();
      });
    };

    const scheduleReconnect = () => {
      if (stopped) return;
      attempt += 1;
      const delay = Math.min(15000, 500 * 2 ** Math.min(attempt, 5));
      reconnectTimer = setTimeout(connect, delay);
    };

    connect();

    return () => {
      stopped = true;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [apiUrl, router]);

  return null;
}
