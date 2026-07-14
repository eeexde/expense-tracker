import { Platform } from 'react-native';
import {
  initExecutorch,
  LLMModule,
  QWEN3_1_7B_QUANTIZED,
} from 'react-native-executorch';
import { ExpoResourceFetcher } from 'react-native-executorch-expo-resource-fetcher';
import { getSetting } from '../db/settingsRepo';
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

// `initExecutorch` wires up the resource fetcher (Expo's document-directory
// based downloader/cache) used by `LLMModule.fromModelName` below. Must run
// once, before any model load, and never on a platform/test runner where the
// native module isn't present (iOS, web, jest all run this file under
// llmSupported === false).
if (llmSupported) {
  initExecutorch({ resourceFetcher: ExpoResourceFetcher });
}

export type LlmModelState = 'absent' | 'downloading' | 'ready' | 'loading' | 'error';

let module: LLMModule | null = null;
let state: LlmModelState = 'absent';
let progress = 0;
// NOTE: executorch doesn't expose a clean "are the model files already cached
// on disk" check from this module's surface, so this in-memory flag is a
// best-effort proxy: true once `downloadModel` has succeeded in this process.
// It does NOT survive an app restart — after a cold start we don't know
// whether files are cached without attempting a load. `ensureLoaded` handles
// that by just attempting the load and treating success as "was cached".
let hasDownloaded = false;

export function getModelState(): LlmModelState {
  return state;
}

export function getDownloadProgress(): number {
  return progress;
}

/**
 * `fromModelName` both downloads (if not cached) AND loads the model into
 * memory — there is no separate "load" step. Resolves once the instance is
 * ready to `generate()`.
 */
export async function downloadModel(onProgress?: (p: number) => void): Promise<void> {
  if (!llmSupported) return;
  state = 'downloading';
  progress = 0;
  try {
    const instance = await LLMModule.fromModelName(QWEN3_1_7B_QUANTIZED, (p) => {
      progress = p;
      onProgress?.(p);
    });
    instance.configure({ generationConfig: { temperature: 0 } });
    module = instance;
    hasDownloaded = true;
    state = 'ready';
  } catch (error) {
    state = 'error';
    throw error;
  }
}

/**
 * Ensures the model is loaded into RAM, reusing an already-cached download if
 * one exists. `fromModelName` skips the network round-trip when the model
 * files are already on disk, so calling it again here is cheap once
 * `downloadModel` has run at least once (this session, or — best-effort —
 * whenever the files happen to already be cached from a previous session).
 */
export async function ensureLoaded(): Promise<boolean> {
  if (!llmSupported) return false;
  if (module) return true;
  state = 'loading';
  try {
    const instance = await LLMModule.fromModelName(QWEN3_1_7B_QUANTIZED, (p) => {
      progress = p;
    });
    instance.configure({ generationConfig: { temperature: 0 } });
    module = instance;
    hasDownloaded = true;
    state = 'ready';
    return true;
  } catch {
    state = hasDownloaded ? 'error' : 'absent';
    return false;
  }
}

/**
 * Frees model RAM. Model FILES stay cached on disk (executorch's resource
 * fetcher owns that cache) — only the in-memory instance is released. Safe to
 * call on app background; do not call mid-generation.
 */
export function unload(): void {
  if (module) {
    module.delete();
    module = null;
  }
  // Model files remain cached on disk; only the in-RAM instance is gone.
  // getModelState() reflects RAM residency, so this goes back to 'absent'
  // even though `ensureLoaded` can cheaply relight it from the disk cache.
  state = 'absent';
}

export async function classify(
  text: string,
  amountCentavos: number,
): Promise<LlmClassification | null> {
  if (!llmSupported) return null;
  const loaded = await ensureLoaded();
  if (!loaded || !module) return null;
  const activeModule = module;
  // `generate` is stateless — each call is a fresh one-shot completion, no
  // conversation history is kept between calls.
  return classifyWithLlm(
    (prompt) => activeModule.generate([{ role: 'user', content: prompt }]),
    text,
    amountCentavos,
  );
}

/** Enabled by user preference AND the model actually being loaded in RAM. */
export async function llmEnabled(db: Db): Promise<boolean> {
  return llmSupported && (await getSetting(db, 'aiParsingEnabled')) === 'true' && module !== null;
}
