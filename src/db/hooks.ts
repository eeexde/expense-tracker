import { useEffect, useState } from 'react';
import { AppDb } from './client';
import { useDb } from './DbProvider';

/**
 * Run a query against the app DB, re-running whenever `refresh()` bumps the
 * provider version or `deps` change. Returns undefined while loading.
 */
export function useAppQuery<T>(
  query: (db: AppDb) => Promise<T>,
  deps: unknown[] = [],
): T | undefined {
  const { db, version } = useDb();
  const [data, setData] = useState<T | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    query(db).then((result) => {
      if (!cancelled) setData(result);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version, ...deps]);

  return data;
}
