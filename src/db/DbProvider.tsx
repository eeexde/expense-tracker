import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
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
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
