import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { notifyPostedDues } from '@/lib/notifications';
import { subscribeLiveCapture, syncNotifications } from '@/lib/notificationSync';
import { PostedSummary, runCatchUp } from '@/lib/recurringEngine';
import { todayLocal } from '@/theme';
import { AppDb, openAppDb } from './client';

interface DbContextValue {
  db: AppDb;
  /** Bumped after any write; screens re-query when it changes. */
  version: number;
  /** Call after a write so other screens refresh their queries. */
  refresh: () => void;
  /** Recurring/installment transactions posted by catch-up on this app open. */
  catchUp: PostedSummary | null;
}

const DbContext = createContext<DbContextValue | null>(null);

export function DbProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<AppDb | null>(null);
  const [catchUp, setCatchUp] = useState<PostedSummary | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const instance = await openAppDb();
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
            if (s && (s.committed > 0 || s.queued > 0)) setVersion((v) => v + 1);
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
  }, []);

  useEffect(() => {
    if (!db) return;
    const unsubscribe = subscribeLiveCapture(db, () => setVersion((v) => v + 1));
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        syncNotifications(db)
          .then((s) => {
            if (s && (s.committed > 0 || s.queued > 0)) setVersion((v) => v + 1);
          })
          .catch(() => {});
      }
    });
    return () => {
      unsubscribe();
      appState.remove();
    };
  }, [db]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const value = useMemo(
    () => (db ? { db, version, refresh, catchUp } : null),
    [db, version, refresh, catchUp],
  );

  if (error) throw error;
  if (!value) return null; // splash screen still visible while DB opens

  return <DbContext.Provider value={value}>{children}</DbContext.Provider>;
}

export function useDb(): DbContextValue {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error('useDb must be used inside DbProvider');
  return ctx;
}
