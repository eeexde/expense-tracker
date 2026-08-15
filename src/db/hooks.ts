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
 * Use this over `useAppQuery` wherever the screen can render an inline retry:
 * neither hook throws, but this one hands back the failure and a `retry()` so
 * the section can say what went wrong instead of spinning.
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
 * Returns the last successful result, or undefined until one lands.
 *
 * Deliberately does *not* throw. A rejection here reaches nobody: the caller
 * keeps whatever it last had, and a caller that never had anything keeps
 * rendering its own loading state.
 *
 * Rethrowing looks like the more honest option — a failed first load otherwise
 * spins forever — but the only thing standing above these screens is the root
 * `ErrorBoundary`, which sits above the router *and* the `DbProvider`. So a
 * throw does not surface an error next to the dead section; it replaces the
 * entire app, and its "Try again" remounts the navigator and drops the user at
 * the initial route, discarding any half-filled modal form on the way —
 * `pay-utang`'s typed amount, `notification-inbox`'s edited note. Trading a
 * common mild failure (a spinner) for a rare severe one (the form is gone) is
 * the wrong way round.
 *
 * A screen that can do better than a spinner should use `useAppQueryResult`
 * directly and render a `QueryErrorNotice` — an inline retry that re-runs just
 * that query and costs the section rather than the navigator. The tabs do.
 *
 * No realistic path rejects today either (the db handle is opened once and
 * cached, and migration failures throw before it exists), so this is about
 * which way an unexpected failure degrades, not a live bug.
 */
export function useAppQuery<T>(
  query: (db: AppDb) => Promise<T>,
  deps: unknown[] = [],
): T | undefined {
  return useAppQueryResult(query, deps).data;
}
