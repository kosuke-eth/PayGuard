import { useCallback, useEffect, useRef, useState } from 'react';
import { toUiError, type UiError } from '../lib/errors';

export interface Polled<T> {
  data: T | null;
  error: UiError | null;
  loading: boolean;
  /** When `data` was last confirmed by the backend. Rows stay visible while a refresh fails. */
  refreshedAt: number | null;
  refresh: () => Promise<void>;
}

/**
 * Keyed polling. One loop per mounted hook and key; it restarts when `key` changes, stops when
 * `intervalMs` is null, and never overlaps requests. A failed refresh keeps the previous data and
 * surfaces the error beside it -- stale is labelled stale, it is not replaced with invented state.
 */
export function usePolling<T>(
  key: string | null,
  load: () => Promise<T>,
  intervalFor: (data: T | null) => number | null,
  onError?: (error: unknown) => void,
): Polled<T> {
  const [held, setHeld] = useState<{ key: string; value: T } | null>(null);
  // Data loaded for a previous key is never handed out under a new one, not even for one render.
  const data = held && held.key === key ? held.value : null;
  const keyRef = useRef(key);
  keyRef.current = key;
  const [error, setError] = useState<UiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);

  const loadRef = useRef(load);
  const intervalRef = useRef(intervalFor);
  const onErrorRef = useRef(onError);
  loadRef.current = load;
  intervalRef.current = intervalFor;
  onErrorRef.current = onError;

  const latest = useRef<T | null>(null);
  latest.current = data;
  const generation = useRef(0);
  const busy = useRef(false);

  const run = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const mine = generation.current;
    try {
      const next = await loadRef.current();
      if (mine !== generation.current) return;
      latest.current = next;
      if (keyRef.current !== null) setHeld({ key: keyRef.current, value: next });
      setError(null);
      setRefreshedAt(Date.now());
    } catch (caught) {
      if (mine !== generation.current) return;
      setError(toUiError(caught));
      onErrorRef.current?.(caught);
    } finally {
      busy.current = false;
      if (mine === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    generation.current += 1;
    busy.current = false;
    setError(null);
    setRefreshedAt(null);
    if (key === null) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const tick = async () => {
      await run();
      if (stopped) return;
      const wait = intervalRef.current(latest.current);
      if (wait !== null) timer = setTimeout(tick, wait);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [key, run]);

  return { data, error, loading, refreshedAt, refresh: run };
}
