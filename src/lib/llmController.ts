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
// Transient, in-memory RAM state only: 'ready' = loaded in memory this session,
// 'downloading'/'loading' = in flight, 'error' = last op failed, 'absent' = not
// in RAM. It does NOT tell you whether the files are on disk — that's the
// persistent `aiModelDownloaded` flag, read via isModelDownloaded(db). The UI
// (Task 5) combines the two: not-downloaded → show Download; downloaded → show
// the AI toggle + a Delete button.
let state: LlmModelState = 'absent';
let progress = 0;

/** In-memory RAM state. See LlmModelState / the `state` comment above. */
export function getModelState(): LlmModelState {
  return state;
}

export function getDownloadProgress(): number {
  return progress;
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
 */
export async function downloadModel(db: Db, onProgress?: (p: number) => void): Promise<void> {
  if (!llmSupported) return;
  // A second Download tap while one is running joins the same download.
  if (downloadInFlight) return downloadInFlight;
  downloadInFlight = (async () => {
    state = 'downloading';
    progress = 0;
    try {
      const instance = await LLMModule.fromModelName(QWEN3_1_7B_QUANTIZED, (p) => {
        progress = p;
        onProgress?.(p);
      });
      instance.configure({ generationConfig: { temperature: 0 } });
      modelInstance = instance;
      state = 'ready';
      await setSetting(db, DOWNLOADED_KEY, 'true');
    } catch (error) {
      state = 'error';
      throw error;
    }
  })();
  try {
    return await downloadInFlight;
  } finally {
    downloadInFlight = null;
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
  if (modelInstance) return true;
  // Join an in-flight load (from a concurrent classify() or a download that
  // already loads into RAM) instead of starting a second one.
  if (downloadInFlight) return downloadInFlight.then(() => modelInstance != null).catch(() => false);
  if (loadInFlight) return loadInFlight;
  loadInFlight = (async () => {
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
      return true;
    } catch {
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
 * Frees model RAM. Model FILES stay cached on disk and the persistent
 * `aiModelDownloaded` flag is untouched — only the in-memory instance is
 * released, so ensureLoaded() can relight it from cache later. Safe to call on
 * app background; do not call mid-generation.
 */
export function unload(): void {
  if (modelInstance) {
    modelInstance.delete();
    modelInstance = null;
  }
  state = 'absent';
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
 */
export async function deleteModel(db: Db): Promise<void> {
  if (!llmSupported) return;
  unload();
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
  if (!activeModule) return null;
  // `generate` is stateless — each call is a fresh one-shot completion, no
  // conversation history is kept between calls.
  return classifyWithLlm(
    (prompt) => activeModule.generate([{ role: 'user', content: prompt }]),
    text,
    amountCentavos,
  );
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
