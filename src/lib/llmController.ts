import { Platform } from 'react-native';
import {
  initExecutorch,
  LLMModule,
  QWEN3_1_7B_QUANTIZED,
} from 'react-native-executorch';
import { ExpoResourceFetcher } from 'react-native-executorch-expo-resource-fetcher';
import { getSetting, setSetting } from '../db/settingsRepo';
import { classifyWithLlm, LlmClassification } from './llmParser';

/**
 * Works against both drizzle drivers (expo-sqlite on device,
 * better-sqlite3 in tests) — they share the same query API.
 */
type Db = any;

/**
 * react-native-executorch ships arm64 native libs only, and the LLM path is
 * only wired for Android (SDK 33+ keeps us on devices with enough RAM/NNAPI
 * support to be worth attempting). This is the ONLY file that imports
 * react-native-executorch — everything else goes through the functions below.
 */
export const llmSupported = Platform.OS === 'android' && Number(Platform.Version) >= 33;

/**
 * app_settings key persisting whether the ~1GB model files have been downloaded
 * to disk. This is the source of truth for "is the model available", NOT the
 * in-memory `modelInstance` var — the RAM instance resets on every app restart
 * while the cached files survive, so relying on `modelInstance` would disable
 * classification after a cold start until something re-primed it.
 */
const DOWNLOADED_KEY = 'aiModelDownloaded';

// `initExecutorch` wires up the resource fetcher (Expo's document-directory
// based downloader/cache) used by `LLMModule.fromModelName` below. Must run
// once, before any model load, and never on a platform/test runner where the
// native module isn't present (iOS, web, jest all run this file under
// llmSupported === false).
if (llmSupported) {
  initExecutorch({ resourceFetcher: ExpoResourceFetcher });
}

export type LlmModelState = 'absent' | 'downloading' | 'ready' | 'loading' | 'error';

let modelInstance: LLMModule | null = null;
// Shared in-flight guards. Loading the ~1GB model twice concurrently (e.g. a
// batch notification sync firing several classify() calls on a cold start)
// would kick off two `fromModelName` loads and OOM the device. These hold the
// single active operation so concurrent callers await the SAME promise instead
// of starting a competing load/download. Both are cleared in a `finally`.
let loadInFlight: Promise<boolean> | null = null;
let downloadInFlight: Promise<void> | null = null;
// The running teardown, if any. Set for the whole of deleteModel(): loads and
// inferences refuse to start while it is non-null, so the teardown has a
// bounded set of operations to wait for and nothing relights the ~1GB model
// behind its back. Held here (not a bare boolean) so a second Delete tap and a
// Download tap can join it instead of racing the file deletion.
let deleteInFlight: Promise<void> | null = null;
// Set when unload() (app backgrounded) arrives while a load/download is still
// in flight. There is nothing resident to free at that moment — `fromModelName`
// hands back no handle until it resolves, and the load is not cancellable — so
// the free is deferred to the instant the instance exists. Without it, that
// load completes into the background and the app sits on ~1GB that nothing
// releases until the NEXT background transition, which requires a foreground
// first. Cleared by whichever load consumes it, and re-cleared at the start of
// every load so a request can never outlive the operation it was aimed at.
let unloadRequested = false;
// Every inference currently holding a native handle, keyed by the INSTANCE it
// runs against. `instance.delete()` under a running `generate()` is a
// use-after-free on native memory, so the free waits for that instance's
// holders. Keyed rather than one flat set because a hold routinely outlives the
// handle it was taken on — classifyWithLlm abandons at 5s while the native
// Qwen3-1.7B call runs for tens of seconds — and in a flat set that stale
// holder blocks the free of every instance loaded afterwards.
const busyHolders = new Map<LLMModule, Set<Promise<void>>>();
/**
 * How long a free waits for the inferences holding an instance. Unbounded, one
 * `generate()` that never settles pins `deleteInFlight` forever: ensureLoaded
 * then returns false and classify() returns null for the rest of the session
 * while the UI still shows AI parsing as on.
 */
const HOLDER_WAIT_MS = 60_000;
// Bumped every time the native handle is released. An inference that started
// before the bump answered for a model that no longer exists (deleted, or freed
// on app background), so its result is discarded rather than written to a row.
let modelGeneration = 0;
// Transient, in-memory RAM state only: 'ready' = loaded in memory this session,
// 'downloading'/'loading' = in flight, 'error' = last op failed, 'absent' = not
// in RAM. It does NOT tell you whether the files are on disk — that's the
// persistent `aiModelDownloaded` flag, read via isModelDownloaded(db). The UI
// (Task 5) combines the two: not-downloaded → show Download; downloaded → show
// the AI toggle + a Delete button.
let state: LlmModelState = 'absent';
// Message of the last failed download, or null. Lives here rather than in the
// UI because the download outlives the screen that started it: auto-log is a
// modal, so every dismiss/reopen mounts a fresh section that re-joins the same
// download. If each of those reported the failure itself the user would get one
// stacked alert per time they opened the screen. Module-level, the failure is
// reported once — the currently mounted section just renders it. Cleared when a
// new download starts.
let lastError: string | null = null;
let progress = 0;
// Every listener currently interested in the single in-flight download. The UI
// that started a ~1GB download is routinely unmounted before it finishes (the
// user navigates away), and the remounted one must be able to attach to the
// SAME download — so progress is broadcast to all listeners rather than only to
// the callback of whichever caller happened to start it.
const progressListeners = new Set<(p: number) => void>();

function emitProgress(p: number): void {
  progress = p;
  for (const listener of progressListeners) listener(p);
}

/** In-memory RAM state. See LlmModelState / the `state` comment above. */
export function getModelState(): LlmModelState {
  return state;
}

export function getDownloadProgress(): number {
  return progress;
}

/**
 * Message of the last failed download, or null if the last one succeeded or
 * none has run. Survives the screen that started the download, so a remounted
 * UI can render the failure instead of every instance alerting about it.
 */
export function getLastDownloadError(): string | null {
  return lastError;
}

/**
 * Listen to the in-flight download's progress. Returns an unsubscribe. A
 * listener that arrives mid-download is fired immediately with the current
 * value, so a freshly mounted progress bar starts where the download actually
 * is instead of at 0%.
 */
export function subscribeToDownloadProgress(listener: (p: number) => void): () => void {
  progressListeners.add(listener);
  if (downloadInFlight) listener(progress);
  return () => {
    progressListeners.delete(listener);
  };
}

/**
 * Persistent "are the model files on disk" flag — survives app restarts, unlike
 * getModelState(). The UI uses this to decide Download-vs-toggle.
 */
export async function isModelDownloaded(db: Db): Promise<boolean> {
  if (!llmSupported) return false;
  return (await getSetting(db, DOWNLOADED_KEY)) === 'true';
}

/**
 * Downloads the model files to disk AND loads them into RAM — this is the ONLY
 * function that hits the network. `fromModelName` both downloads (if not
 * cached) and loads; there is no separate load step. On success it persists the
 * `aiModelDownloaded` flag so ensureLoaded() can cheaply reload from cache after
 * a restart without ever re-downloading.
 *
 * Also the way to REJOIN a download already in progress: call it again with a
 * fresh `onProgress` and you get that download's ticks plus its completion,
 * without a second `fromModelName` ever being started.
 */
export async function downloadModel(db: Db, onProgress?: (p: number) => void): Promise<void> {
  if (!llmSupported) return;
  // Registered before the join below so a late caller starts receiving the
  // running download's progress rather than waiting silently at 0%.
  const unsubscribe = onProgress ? subscribeToDownloadProgress(onProgress) : undefined;
  try {
    // A second Download tap while one is running joins the same download —
    // never two concurrent ~1GB loads (that OOMs the device).
    if (downloadInFlight) return await downloadInFlight;
    downloadInFlight = (async () => {
      // Captured before the first await, so these are the OTHER operations in
      // flight, never this one. A cold ensureLoaded can be holding a ~1GB load
      // right now: the Download/Delete buttons render off the PERSISTENT flag,
      // which is true for the whole of that load. Starting a second
      // `fromModelName` against it is exactly the OOM the in-flight guard
      // exists to prevent — so join it (and any teardown) first.
      const pendingLoad = loadInFlight;
      const pendingDelete = deleteInFlight;
      // See the matching line in ensureLoaded: only ever clears a request armed
      // against an earlier operation.
      unloadRequested = false;
      state = 'downloading';
      lastError = null;
      emitProgress(0);
      try {
        // Guarded so the common case — nothing else in flight, no resident
        // instance — still reaches `fromModelName` in this same tick.
        if (pendingLoad || pendingDelete) {
          await Promise.allSettled([pendingLoad, pendingDelete]);
          // The joined load reports itself 'ready' on the way out.
          state = 'downloading';
        }
        // Whatever that load left resident has to go before we allocate
        // another ~1GB copy. Waits for any inference still holding it.
        if (modelInstance) await freeInstance();
        const instance = await LLMModule.fromModelName(QWEN3_1_7B_QUANTIZED, emitProgress);
        instance.configure({ generationConfig: { temperature: 0 } });
        modelInstance = instance;
        state = 'ready';
        await setSetting(db, DOWNLOADED_KEY, 'true');
        // Backgrounded mid-download: the files are on disk (the flag above says
        // so) but nothing needs the ~1GB in RAM.
        takePendingUnload();
      } catch (error) {
        unloadRequested = false;
        state = 'error';
        lastError = error instanceof Error ? error.message : 'Download failed.';
        throw error;
      }
    })();
    try {
      return await downloadInFlight;
    } finally {
      downloadInFlight = null;
    }
  } finally {
    unsubscribe?.();
  }
}

/**
 * Loads the model into RAM if it isn't already, WITHOUT ever downloading. If the
 * instance is already in memory, returns true immediately. Otherwise it only
 * proceeds when the persistent `aiModelDownloaded` flag is set — meaning the
 * files are on disk — so calling `fromModelName` here is a fast local load with
 * no network round-trip. If the flag isn't set, returns false rather than
 * kicking off a surprise multi-hundred-MB download (that's downloadModel's job).
 */
export async function ensureLoaded(db: Db): Promise<boolean> {
  if (!llmSupported) return false;
  // A teardown is freeing the handle and deleting the files: neither the
  // resident instance nor a fresh load survives it, so report "no model" and
  // let the caller fall back to rules instead of racing it.
  if (deleteInFlight) return false;
  if (modelInstance) return true;
  // Join an in-flight load (from a concurrent classify() or a download that
  // already loads into RAM) instead of starting a second one.
  if (downloadInFlight) return downloadInFlight.then(() => modelInstance != null).catch(() => false);
  if (loadInFlight) return loadInFlight;
  loadInFlight = (async () => {
    // Runs in the same synchronous step as the assignment below, so it can only
    // ever clear a request armed against an EARLIER operation, never one aimed
    // at this load.
    unloadRequested = false;
    if (!(await isModelDownloaded(db))) return false;
    state = 'loading';
    try {
      // Files are cached (flag is set) → this resolves from disk, no download.
      const instance = await LLMModule.fromModelName(QWEN3_1_7B_QUANTIZED, (p) => {
        progress = p;
      });
      instance.configure({ generationConfig: { temperature: 0 } });
      modelInstance = instance;
      state = 'ready';
      // The app backgrounded while this load was in flight: free what we just
      // allocated instead of holding ~1GB until the next background.
      if (takePendingUnload()) return false;
      return true;
    } catch {
      unloadRequested = false;
      state = 'error';
      return false;
    }
  })();
  try {
    return await loadInFlight;
  } finally {
    loadInFlight = null;
  }
}

/**
 * Marks the native handle as in use for one inference and returns the release
 * callback. Callers register the hold in the SAME synchronous step as their
 * `modelInstance` check — a teardown starting a microtask later must already
 * see the holder, or it frees the handle out from under `generate()`.
 */
function holdModel(instance: LLMModule): () => void {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holders = busyHolders.get(instance) ?? new Set<Promise<void>>();
  holders.add(held);
  busyHolders.set(instance, holders);
  return () => {
    const current = busyHolders.get(instance);
    current?.delete(held);
    if (current && current.size === 0) busyHolders.delete(instance);
    release();
  };
}

/**
 * Waits for the given holders, but no longer than HOLDER_WAIT_MS. Resolves true
 * when every inference finished, false when the bound expired with one still
 * running.
 */
function waitForHolders(holders: Promise<void>[]): Promise<boolean> {
  if (holders.length === 0) return Promise.resolve(true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), HOLDER_WAIT_MS);
  });
  return Promise.race([Promise.all(holders).then(() => true), bound]).then((finished) => {
    clearTimeout(timer);
    return finished;
  });
}

/**
 * Takes the resident handle off the books — synchronously, so nothing hands it
 * out again — and returns it with the inferences that were holding it. The
 * caller decides whether those make it safe to `.delete()`.
 */
function detachInstance(): { instance: LLMModule; holders: Promise<void>[] } | null {
  const instance = modelInstance;
  if (!instance) return null;
  const holders = [...(busyHolders.get(instance) ?? [])];
  modelInstance = null;
  // Anything mid-inference is now answering for a model that no longer exists.
  modelGeneration += 1;
  // The handle is off the books; its holders go with it, so a hold that outlives
  // it can never be waited on by the free of a LATER instance.
  busyHolders.delete(instance);
  return { instance, holders };
}

/**
 * Detaches the native handle and frees it, leaving `state` alone (unload() owns
 * that). Detaching is synchronous so nothing hands the handle out again, but
 * the `.delete()` itself waits for any running inference — freeing memory a
 * `generate()` is reading is a use-after-free that takes the process down with
 * it. The returned promise settles once the native memory is actually gone (or,
 * past the bound, once the handle has been abandoned), so a caller about to
 * allocate another ~1GB copy can await it.
 */
function freeInstance(): Promise<void> {
  const detached = detachInstance();
  if (!detached) return Promise.resolve();
  const { instance, holders } = detached;
  if (holders.length === 0) {
    instance.delete();
    return Promise.resolve();
  }
  return waitForHolders(holders).then((finished) => {
    // Past the bound the native call is still reading this handle, and
    // `.delete()` under it is a use-after-free that takes the process down.
    // Abandoning the handle leaks it instead — one instance of native memory
    // the user survives, versus a crash or a permanently dead feature.
    if (finished) instance.delete();
  });
}

/**
 * Frees an instance that materialised after an unload() request, if one is
 * armed. Returns true when it did — the load's own "loaded" answer is stale at
 * that point, since nothing is resident any more.
 */
function takePendingUnload(): boolean {
  if (!unloadRequested) return false;
  unloadRequested = false;
  void freeInstance();
  state = 'absent';
  return true;
}

/**
 * Frees model RAM. Model FILES stay cached on disk and the persistent
 * `aiModelDownloaded` flag is untouched — only the in-memory instance is
 * released, so ensureLoaded() can relight it from cache later. Safe to call on
 * app background even mid-generation: the instance is detached immediately and
 * the native free is queued behind the running inference, whose answer is then
 * discarded (see the generation counter in classify()).
 *
 * Safe to call mid-LOAD too, which is the common case — DbProvider fires
 * syncNotifications on mount and that can start a multi-second cold load. There
 * is nothing to free yet, so the request is armed and the load frees what it
 * produces the moment it produces it.
 */
export function unload(): void {
  void freeInstance();
  state = 'absent';
  if (loadInFlight || downloadInFlight) unloadRequested = true;
}

/**
 * Fully removes the model: frees RAM, deletes the cached files from disk, and
 * clears the persistent flag so isModelDownloaded() reads false again. Used by
 * the Delete button in settings to reclaim storage.
 *
 * File deletion uses ExpoResourceFetcher.deleteResources(...sources), which
 * (per BaseResourceFetcherClass) "Delete[s] the local files corresponding to
 * the given sources" and is "a no-op for sources whose file does not exist".
 * We pass the three ResourceSources fromModelName was given.
 *
 * Reachable at any moment: the Delete button renders off the PERSISTENT flag,
 * so it is on screen while a cold ensureLoaded is still loading, and an
 * incoming bank notification can be mid-classify() when it is tapped. Both are
 * awaited before anything is freed.
 */
export async function deleteModel(db: Db): Promise<void> {
  if (!llmSupported) return;
  // A second Delete tap joins the running teardown rather than deleting twice.
  if (deleteInFlight) return deleteInFlight;
  // The IIFE's synchronous prologue and this assignment run in one uninterrupted
  // step, so by the time anything else executes, `deleteInFlight` is set and no
  // new load or inference can start.
  deleteInFlight = (async () => {
    const pendingLoad = loadInFlight;
    const pendingDownload = downloadInFlight;
    // Nothing may be holding the handle when it is freed: a load would assign
    // `modelInstance` AFTER the free (leaving ~1GB resident for a model whose
    // files are gone), and a `generate()` would be left reading freed native
    // memory. One wait is enough — ensureLoaded/classify/downloadModel all bail
    // or join while `deleteInFlight` is set, so no new work can appear behind it.
    await Promise.allSettled([pendingLoad, pendingDownload]);
    // The inferences holding whatever is resident now (the load joined above may
    // have just produced it), waited out BEFORE the detach so an answer that
    // lands in time still counts — the teardown waits rather than killing it.
    // Scoped to this instance, so a stale hold from an earlier one cannot block
    // it, and bounded, so a wedged native `generate()` cannot pin
    // `deleteInFlight` — and with it every later load and inference — for the
    // rest of the session.
    const resident = modelInstance;
    const settled = await waitForHolders(resident ? [...(busyHolders.get(resident) ?? [])] : []);
    const detached = detachInstance();
    state = 'absent';
    // Past the bound the native call still holds the handle; abandon it rather
    // than free memory it is reading. The files below still go.
    if (detached && settled) detached.instance.delete();
    // The model is going away; a download failure recorded against it is no
    // longer something to render (it would resurface as "Retry download").
    lastError = null;
    try {
      await ExpoResourceFetcher.deleteResources(
        QWEN3_1_7B_QUANTIZED.modelSource,
        QWEN3_1_7B_QUANTIZED.tokenizerSource,
        QWEN3_1_7B_QUANTIZED.tokenizerConfigSource,
      );
    } finally {
      // Even if file deletion fails, flip the flag so AI is disabled and the UI
      // stops offering it; any files that survived are harmless dead weight.
      await setSetting(db, DOWNLOADED_KEY, 'false');
    }
  })();
  try {
    return await deleteInFlight;
  } finally {
    deleteInFlight = null;
  }
}

export async function classify(
  db: Db,
  text: string,
  amountCentavos: number,
): Promise<LlmClassification | null> {
  if (!llmSupported) return null;
  // ensureLoaded never downloads, so classify() can never surprise-download:
  // if the model isn't on disk it returns false here and we fall back to null.
  if (!(await ensureLoaded(db))) return null;
  const activeModule = modelInstance;
  // The teardown check and the hold below happen in one synchronous step: a gap
  // here is a window in which deleteModel sees no holder, frees the handle, and
  // leaves `generate` reading freed native memory.
  if (!activeModule || deleteInFlight) return null;
  const startedAt = modelGeneration;
  const release = holdModel(activeModule);
  // classifyWithLlm abandons the inference after its 5s timeout, but the NATIVE
  // call keeps running against this handle — so the hold is released off the
  // inference promise, not when classify() returns.
  const pending: { inference?: Promise<unknown> } = {};
  try {
    // `generate` is stateless — each call is a fresh one-shot completion, no
    // conversation history is kept between calls.
    const result = await classifyWithLlm(
      (prompt) => {
        const inference = activeModule.generate([{ role: 'user', content: prompt }]);
        pending.inference = inference;
        return inference;
      },
      text,
      amountCentavos,
    );
    // The handle we ran against was released while we were generating (deleted,
    // or freed on app background). The answer describes a model the user no
    // longer has, so drop it rather than write it to a row.
    return startedAt === modelGeneration ? result : null;
  } finally {
    if (pending.inference) void pending.inference.then(release, release);
    else release();
  }
}

/**
 * Enabled by user preference AND the model files being downloaded. Deliberately
 * does NOT check the in-memory `modelInstance` — the persistent flag keeps it true
 * across restarts, so a cold-start classify() (which loads from cache on its
 * first ensureLoaded call) still works.
 */
export async function llmEnabled(db: Db): Promise<boolean> {
  return (
    llmSupported &&
    (await getSetting(db, 'aiParsingEnabled')) === 'true' &&
    (await getSetting(db, DOWNLOADED_KEY)) === 'true'
  );
}

/**
 * TEST ONLY. Drops every module-level guard back to a cold start.
 *
 * The concurrency suite deliberately parks loads inside `fromModelName` and
 * some of them are never released, so without this a test hands its
 * `loadInFlight` / holders / generation counter to the next one: mutating a
 * single guard then fails a handful of unrelated tests, which is pollution
 * rather than signal about which guard broke.
 */
export function __resetForTests(): void {
  modelInstance = null;
  loadInFlight = null;
  downloadInFlight = null;
  deleteInFlight = null;
  unloadRequested = false;
  busyHolders.clear();
  progressListeners.clear();
  modelGeneration = 0;
  state = 'absent';
  lastError = null;
  progress = 0;
}
