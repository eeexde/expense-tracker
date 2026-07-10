import { AppDb } from '@/db/client';
import {
  CapturedNotification,
  expirePending,
  ingestCaptured,
  watchedPackages,
} from '@/db/notificationRepo';
import {
  addCapturedListener,
  CapturedEntry,
  drainBuffer,
  isAvailable,
  setWatchedPackages,
} from '../../modules/notification-listener';

export interface SyncSummary {
  committed: number;
  queued: number;
}

/**
 * Full sync pass: push watched packages down to the native listener, drain
 * whatever it buffered while we were away, ingest, then run 2-day expiry.
 * Safe no-op off Android.
 */
export async function syncNotifications(db: AppDb): Promise<SyncSummary | null> {
  if (!isAvailable) return null;
  setWatchedPackages(await watchedPackages(db));
  const captured = drainBuffer() as CapturedNotification[];
  const nowIso = new Date().toISOString();
  const ingest = await ingestCaptured(db, captured, nowIso);
  const expiry = await expirePending(db, nowIso);
  return {
    committed: ingest.committed + expiry.committed,
    queued: ingest.queued,
  };
}

/** Live ingest while the app is open. Returns an unsubscribe function. */
export function subscribeLiveCapture(db: AppDb, onChange: () => void): () => void {
  if (!isAvailable) return () => {};
  const sub = addCapturedListener(async (entry: CapturedEntry) => {
    await ingestCaptured(db, [entry], new Date().toISOString());
    onChange();
  });
  return () => sub.remove();
}
