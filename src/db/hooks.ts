import { useCallback, useEffect, useState } from 'react';
import { AppDb } from './client';
import { useDb } from './DbProvider';

export interface AppQueryResult<T> {
  /**
   * Last *successful* result, `undefined` until the first one lands. A later
   * rejection does not clear it: a transient failure on a post-write
   * `refresh()` must not blank a screen that already has good data to show.
   */
  data: T | undefined;
  /**
   * Newest failure, or null. Cleared the moment a run succeeds, and by
   * `retry()` — but deliberately *not* at the top of every run, so a re-query
   * triggered by a dep change keeps showing the failure it is trying to
   * replace rather than flashing back to a spinner. (Clearing it in the effect
   * body would also be a cascading synchronous setState, which the compiler's
   * lint rejects outright.)
   */
  error: Error | null;
  /** Re-runs the query in place, without unmounting anything. */
  retry: () => void;
}

/**
 * Run a query against the app DB, re-running whenever `refresh()` bumps the
 * provider version, `deps` change, or `retry()` is called.
 *
 * Use this over `useAppQuery` wherever the screen can render an inline retry —
 * nothing here throws, so a failure costs the failed section rather than the
 * whole navigator.
 */
export function useAppQueryResult<T>(
  query: (db: AppDb) => Promise<T>,
  deps: unknown[] = [],
): AppQueryResult<T> {
  const { db, version } = useDb();
  // One cell, because the pair moves together: a success is also the end of
  // whatever failure preceded it, and a failure has to leave `data` alone.
  const [state, setState] = useState<{ data: T | undefined; error: Error | null }>({
    data: undefined,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    query(db).then(
      (result) => {
        if (!cancelled) setState({ data: result, error: null });
      },
      (e: unknown) => {
        if (!cancelled) {
          setState((prev) => ({
            data: prev.data,
            error: e instanceof Error ? e : new Error(String(e)),
          }));
        }
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version, attempt, ...deps]);

  const retry = useCallback(() => {
    setState((prev) => ({ data: prev.data, error: null }));
    setAttempt((n) => n + 1);
  }, []);

  return { data: state.data, error: state.error, retry };
}

/**
 * `useAppQueryResult` for the callers that have nothing to render but the data.
 * Returns undefined while loading.
 *
 * A rejection only reaches the root `ErrorBoundary` when there is no data at
 * all — i.e. the very first load failed, so the screen would otherwise spin
 * forever. Once a result has landed, a later failure is swallowed in favour of
 * the last good one: the alternative is that one rejected `refresh()` replaces
 * the whole app with the recovery screen, whose "Try again" remounts the
 * navigator and drops the user at the initial route, discarding any half-filled
 * modal form on the way. No realistic path rejects today (the db handle is
 * opened once and cached, and migration failures throw before it exists) — this
 * is hardening, not a live bug.
 */
export function useAppQuery<T>(
  query: (db: AppDb) => Promise<T>,
  deps: unknown[] = [],
): T | undefined {
  const { data, error } = useAppQueryResult(query, deps);

  if (error !== null && data === undefined) throw error;

  return data;
}
