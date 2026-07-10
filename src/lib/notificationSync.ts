import { AppDb } from '@/db/client';
import { expirePending, ingestCaptured, watchedPackages } from '@/db/notificationRepo';
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
 * All ingest runs through one chain: the drain path (foreground sync) and the
 * live event path can otherwise interleave at await points and double-insert
 * the same notification (keyExists is check-then-insert, not atomic).
 */
let ingestChain: Promise<unknown> = Promise.resolve();
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = ingestChain.then(work, work);
  ingestChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * Full sync pass: push watched packages down to the native listener, drain
 * whatever it buffered while we were away, ingest, then run 2-day expiry.
 * Safe no-op off Android.
 */
export async function syncNotifications(db: AppDb): Promise<SyncSummary | null> {
  if (!isAvailable) return null;
  return enqueue(async () => {
    setWatchedPackages(await watchedPackages(db));
    // CapturedEntry is kept structurally identical to CapturedNotification.
    const captured = drainBuffer();
    const nowIso = new Date().toISOString();
    const ingest = await ingestCaptured(db, captured, nowIso);
    const expiry = await expirePending(db, nowIso);
    return {
      committed: ingest.committed + expiry.committed,
      queued: ingest.queued,
    };
  });
}

/** Live ingest while the app is open. Returns an unsubscribe function. */
export function subscribeLiveCapture(db: AppDb, onChange: () => void): () => void {
  if (!isAvailable) return () => {};
  const sub = addCapturedListener((entry: CapturedEntry) => {
    enqueue(() => ingestCaptured(db, [entry], new Date().toISOString()))
      .then(() => onChange())
      .catch(() => {
        // best-effort, like every other ingest call site
      });
  });
  return () => sub.remove();
}
