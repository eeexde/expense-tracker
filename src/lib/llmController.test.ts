/**
 * Guards the concurrency invariant: the ~1GB model must never be loaded or
 * downloaded twice at once (a batch notification sync fires several classify()
 * calls on a cold start — without the in-flight guard each would start its own
 * `fromModelName` load and OOM the device).
 *
 * Runs in the node 'logic' project, so react-native + executorch (native-only)
 * are mocked. Platform is forced to android/34 so `llmSupported` is true and the
 * real code paths execute.
 *
 * ts-jest hoists the jest.mock() calls above these imports, so llmController
 * loads with react-native / executorch already mocked.
 */
import { LLMModule } from 'react-native-executorch';
import { downloadModel, ensureLoaded, unload } from './llmController';

jest.mock('react-native', () => ({
  Platform: { OS: 'android', Version: 34 },
}));

jest.mock('react-native-executorch', () => ({
  initExecutorch: jest.fn(),
  LLMModule: {
    fromModelName: jest.fn(async () => ({
      configure: jest.fn(),
      generate: jest.fn(),
      delete: jest.fn(),
    })),
  },
  QWEN3_1_7B_QUANTIZED: {
    modelSource: 'm',
    tokenizerSource: 't',
    tokenizerConfigSource: 'c',
  },
}));

jest.mock(
  'react-native-executorch-expo-resource-fetcher',
  () => ({ ExpoResourceFetcher: { deleteResources: jest.fn(async () => {}) } }),
  { virtual: true },
);

const settings: Record<string, string> = {};
jest.mock('../db/settingsRepo', () => ({
  getSetting: jest.fn(async (_db: unknown, key: string) => settings[key] ?? null),
  setSetting: jest.fn(async (_db: unknown, key: string, value: string) => {
    settings[key] = value;
  }),
}));

const fromModelName = LLMModule.fromModelName as jest.Mock;
const db = {};

beforeEach(() => {
  fromModelName.mockClear();
  unload();
  for (const k of Object.keys(settings)) delete settings[k];
});

describe('ensureLoaded concurrency', () => {
  it('loads the model only once for concurrent callers', async () => {
    settings.aiModelDownloaded = 'true';
    const [a, b, c] = await Promise.all([
      ensureLoaded(db),
      ensureLoaded(db),
      ensureLoaded(db),
    ]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(c).toBe(true);
    expect(fromModelName).toHaveBeenCalledTimes(1);
  });

  it('returns true immediately once loaded, without reloading', async () => {
    settings.aiModelDownloaded = 'true';
    await ensureLoaded(db);
    expect(fromModelName).toHaveBeenCalledTimes(1);
    await ensureLoaded(db);
    expect(fromModelName).toHaveBeenCalledTimes(1);
  });

  it('does not load (or download) when the model files are absent', async () => {
    // aiModelDownloaded flag unset
    const ok = await ensureLoaded(db);
    expect(ok).toBe(false);
    expect(fromModelName).not.toHaveBeenCalled();
  });

  it('reloads after unload frees RAM', async () => {
    settings.aiModelDownloaded = 'true';
    await ensureLoaded(db);
    unload();
    await ensureLoaded(db);
    expect(fromModelName).toHaveBeenCalledTimes(2);
  });
});

describe('downloadModel concurrency', () => {
  it('downloads only once for concurrent taps', async () => {
    await Promise.all([downloadModel(db), downloadModel(db)]);
    expect(fromModelName).toHaveBeenCalledTimes(1);
    expect(settings.aiModelDownloaded).toBe('true');
  });

  it('a concurrent ensureLoaded joins the download instead of loading again', async () => {
    const dl = downloadModel(db);
    const load = ensureLoaded(db);
    const [, loaded] = await Promise.all([dl, load]);
    expect(loaded).toBe(true);
    expect(fromModelName).toHaveBeenCalledTimes(1);
  });
});
