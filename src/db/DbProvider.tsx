import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { unload as unloadLlm } from '@/lib/llmController';
import { notifyPostedDues } from '@/lib/notifications';
import { subscribeLiveCapture, syncNotifications } from '@/lib/notificationSync';
import { PostedSummary, runCatchUp } from '@/lib/recurringEngine';
import { todayLocal } from '@/theme';
import { AppDb, openAppDb } from './client';

/**
 * Which tables a mounted query read on its last run, or `null` for "we could
 * not tell" — which subscribes it to every write. `null` is the safe value and
 * the starting value: a query that has not run yet, one whose statements we
 * failed to attribute, and one whose last run rejected all sit at `null`.
 */
export interface QueryScope {
  tables: Set<string> | null;
}

interface Subscriber {
  scope: QueryScope;
  notify: () => void;
}

interface DbContextValue {
  db: AppDb;
  /**
   * Bumped only when a write's blast radius is *unknown* — everything re-runs
   * then. Ordinary writes invalidate by table instead, through `registerQuery`.
   */
  version: number;
  /** Call after a write so other screens refresh their queries. */
  refresh: () => void;
  /** Recurring/installment transactions posted by catch-up on this app open. */
  catchUp: PostedSummary | null;
  /**
   * Subscribes a query to the tables it reads; returns an unsubscribe.
   * Optional because the screen tests stub `useDb` with a plain object — those
   * hooks fall back to the `version` counter, i.e. to the old behaviour.
   */
  registerQuery?: (scope: QueryScope, notify: () => void) => () => void;
  /** Handed through the context for the same reason `registerQuery` is. */
  trackReads?: (db: AppDb, onRead: ReadSink) => AppDb;
}

const DbContext = createContext<DbContextValue | null>(null);

// ---------- statement tracking ----------
//
// Both drizzle drivers hand every executed statement to `session.logger`
// before running it, so one logger swap gets us the SQL of every read and
// every write without touching a single call site. Table names are the coarse
// invalidation key: `transactions` is one domain, `utang` another. Anything we
// cannot attribute degrades to "all tables", never to "no tables" — a stale
// screen is the worse bug.

/** Statements that legitimately name no table. */
const CONTROL_SQL = /^\s*(?:begin|commit|rollback|savepoint|release|pragma|analyze|vacuum)\b/i;
const WRITE_SQL = /^\s*(?:insert|update|delete|replace|create|drop|alter)\b/i;
const TABLE_REF = /\b(?:from|join|into|update|table)\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/gi;

function tablesIn(statement: string): string[] {
  const found: string[] = [];
  TABLE_REF.lastIndex = 0;
  let match = TABLE_REF.exec(statement);
  while (match) {
    found.push(match[1].toLowerCase());
    match = TABLE_REF.exec(statement);
  }
  return found;
}

/** Tables written since the last `refresh()`, and whether any was unreadable. */
const pendingWrites = new Set<string>();
let pendingWriteUnknown = false;

/** Returns the written tables, or `null` for "assume the write hit everything". */
function takeWrites(): string[] | null {
  const written = [...pendingWrites];
  const unknown = pendingWriteUnknown;
  pendingWrites.clear();
  pendingWriteUnknown = false;
  return unknown || written.length === 0 ? null : written;
}

export type ReadSink = (tables: string[] | null) => void;

function loggerFor(onRead?: ReadSink) {
  return {
    logQuery(statement: string) {
      if (CONTROL_SQL.test(statement)) return;
      const tables = tablesIn(statement);
      if (WRITE_SQL.test(statement)) {
        if (tables.length === 0) pendingWriteUnknown = true;
        else for (const table of tables) pendingWrites.add(table);
        return;
      }
      onRead?.(tables.length > 0 ? tables : null);
    },
  };
}

/** Records every write made through `db` (and anything derived from it). */
function trackWrites(db: AppDb): AppDb {
  const session = (db as any)?.session;
  if (session) session.logger = loggerFor();
  return db;
}

/**
 * A view of `db` that reports the tables its statements read. Nothing is
 * copied but the session, so the handle, the dialect and every query builder
 * are the real ones; a per-run view is what makes the reads of two queries
 * running at the same time attributable to the right one.
 */
function trackReads(db: AppDb, onRead: ReadSink): AppDb {
  const session = (db as any)?.session;
  if (!session) {
    onRead(null); // no driver to listen to (stubbed provider) — assume everything
    return db;
  }
  const scopedSession = Object.create(session);
  scopedSession.logger = loggerFor(onRead);
  const scoped = Object.create(db as object);
  scoped.session = scopedSession;
  return scoped as AppDb;
}

export function DbProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<AppDb | null>(null);
  const [catchUp, setCatchUp] = useState<PostedSummary | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);
  // Dereferenced only inside callbacks, never during render: `react-hooks/refs`
  // forbids the latter, and the compiler relies on it to memoize this provider.
  const subscribersRef = useRef(new Set<Subscriber>());

  const registerQuery = useCallback((scope: QueryScope, notify: () => void) => {
    const subscriber = { scope, notify };
    subscribersRef.current.add(subscriber);
    return () => {
      subscribersRef.current.delete(subscriber);
    };
  }, []);

  /**
   * Re-runs the mounted queries that read a table this write touched. When the
   * write named no table we can trust, the global `version` bump takes over and
   * every query re-runs — which is what the whole app used to do for every
   * write.
   */
  const refresh = useCallback(() => {
    const written = takeWrites();
    if (written === null) {
      setVersion((v) => v + 1);
      return;
    }
    for (const subscriber of subscribersRef.current) {
      const { tables } = subscriber.scope;
      if (tables === null || written.some((table) => tables.has(table))) subscriber.notify();
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const instance = trackWrites(await openAppDb());
        const summary = await runCatchUp(instance, todayLocal());
        if (cancelled) return;
        setCatchUp(summary);
        setDb(instance);
        notifyPostedDues(summary).catch(() => {
          // Notifications are best-effort; never block startup on them.
        });
        syncNotifications(instance)
          .then((s) => {
            if (cancelled) return;
            if (s && (s.committed > 0 || s.queued > 0)) refresh();
          })
          .catch(() => {
            // best-effort; never block startup
          });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (!db) return;
    const unsubscribe = subscribeLiveCapture(db, refresh);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        syncNotifications(db)
          .then((s) => {
            if (s && (s.committed > 0 || s.queued > 0)) refresh();
          })
          .catch(() => {});
      } else if (state === 'background') {
        unloadLlm();
      }
    });
    return () => {
      unsubscribe();
      appState.remove();
    };
  }, [db, refresh]);

  const value = useMemo(
    () => (db ? { db, version, refresh, catchUp, registerQuery, trackReads } : null),
    [db, version, refresh, catchUp, registerQuery],
  );

  if (error) throw error;
  // Gate on `db` rather than on `value`: `value` carries `registerQuery`, which
  // closes over a ref, and branching on it counts as reading that ref during
  // render. `db` is plain state and says exactly the same thing.
  if (!db) return null; // splash screen still visible while DB opens

  return <DbContext.Provider value={value}>{children}</DbContext.Provider>;
}

export function useDb(): DbContextValue {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error('useDb must be used inside DbProvider');
  return ctx;
}
