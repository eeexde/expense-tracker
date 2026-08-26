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
import { ExpoResourceFetcher } from 'react-native-executorch-expo-resource-fetcher';
import {
  __resetForTests,
  classify,
  deleteModel,
  downloadModel,
  ensureLoaded,
  getLastDownloadError,
  getModelState,
  unload,
} from './llmController';

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
const deleteResources = ExpoResourceFetcher.deleteResources as jest.Mock;
const db = {};

beforeEach(() => {
  fromModelName.mockClear();
  // Not unload(): these tests deliberately park loads inside `fromModelName`
  // and some are never released, so the in-flight guards, holders and
  // generation counter would leak into the next test — a broken guard would
  // then fail a handful of unrelated tests instead of the one that covers it.
  __resetForTests();
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

/**
 * A failed download must be reported by the CONTROLLER, not by whichever
 * component happened to be mounted. auto-log is a modal route: every
 * dismiss/reopen mounts a fresh section that re-joins the same download, so a
 * component-owned alert fires once per instance that ever joined — a stack of
 * identical dialogs when a ~1GB download dies on mobile data.
 */
describe('download failure reporting', () => {
  it('records the failure for a UI that mounts after it happened', async () => {
    fromModelName.mockImplementationOnce(async () => {
      throw new Error('Network request failed');
    });
    await expect(downloadModel(db)).rejects.toThrow('Network request failed');
    expect(getModelState()).toBe('error');
    expect(getLastDownloadError()).toBe('Network request failed');
    // The persistent flag stays unset, so the UI still offers a download.
    expect(settings.aiModelDownloaded).toBeUndefined();
  });

  it('records it once no matter how many callers joined the failed download', async () => {
    let fail: ((e: Error) => void) | undefined;
    fromModelName.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    // Handlers attached the moment the promises exist, so neither rejection is
    // ever unhandled while the other is being awaited.
    const capture = (p: Promise<void>): Promise<Error | null> =>
      p.then(() => null, (e: Error) => e);
    const starter = capture(downloadModel(db));
    const rejoiner = capture(downloadModel(db));
    fail!(new Error('boom'));

    expect((await starter)?.message).toBe('boom');
    expect((await rejoiner)?.message).toBe('boom');
    expect(fromModelName).toHaveBeenCalledTimes(1);
    expect(getLastDownloadError()).toBe('boom');
  });

  it('clears the recorded failure when a retry starts', async () => {
    fromModelName.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    await expect(downloadModel(db)).rejects.toThrow('boom');
    expect(getLastDownloadError()).toBe('boom');

    await downloadModel(db);
    expect(getLastDownloadError()).toBeNull();
    expect(getModelState()).toBe('ready');
  });
});

/**
 * The download outlives the screen that started it. A UI remounted mid-download
 * calls downloadModel again to re-attach: it must join the SAME download (the
 * OOM guard) *and* start receiving its progress, or the bar sits at 0% for the
 * whole ~1GB.
 */
describe('download progress broadcast', () => {
  type FakeInstance = {
    configure: jest.Mock;
    generate: jest.Mock;
    delete: jest.Mock;
    interrupt: jest.Mock;
    setTokenCallback: jest.Mock;
  };
  const fakeInstance = (): FakeInstance => ({
    configure: jest.fn(),
    generate: jest.fn(),
    delete: jest.fn(),
    interrupt: jest.fn(),
    setTokenCallback: jest.fn(),
  });

  it('feeds progress to a caller that joins a download already in flight', async () => {
    let tick: ((p: number) => void) | undefined;
    let finish: ((instance: FakeInstance) => void) | undefined;
    fromModelName.mockImplementationOnce(
      (_model: unknown, onProgress: (p: number) => void) =>
        new Promise<FakeInstance>((resolve) => {
          tick = onProgress;
          finish = resolve;
        }),
    );

    const starter: number[] = [];
    const rejoiner: number[] = [];
    const first = downloadModel(db, (p) => starter.push(p));
    tick!(0.25);
    const second = downloadModel(db, (p) => rejoiner.push(p));
    tick!(0.5);
    finish!(fakeInstance());
    await Promise.all([first, second]);

    expect(fromModelName).toHaveBeenCalledTimes(1);
    expect(starter).toEqual([0, 0.25, 0.5]);
    // Seeded with where the download actually is, then live ticks.
    expect(rejoiner).toEqual([0.25, 0.5]);
  });

  it('reports the downloading state a remounted UI keys off', async () => {
    let finish: ((instance: FakeInstance) => void) | undefined;
    fromModelName.mockImplementationOnce(
      () =>
        new Promise<FakeInstance>((resolve) => {
          finish = resolve;
        }),
    );

    const call = downloadModel(db);
    expect(getModelState()).toBe('downloading');
    finish!(fakeInstance());
    await call;
    expect(getModelState()).toBe('ready');
  });
});

/**
 * Nothing may free the native handle out from under a running operation. Both
 * hazards are one tap away in the real UI: the Delete button renders off the
 * PERSISTENT flag, so it is on screen for the whole of a cold ensureLoaded, and
 * an incoming bank notification can be mid-classify() when it is tapped —
 * `.delete()` on a handle `generate()` is reading is a native use-after-free.
 * The Download button has the mirror hazard: starting a second ~1GB
 * `fromModelName` against a load already in flight is the OOM the in-flight
 * guard exists to prevent.
 */
describe('model lifecycle safety', () => {
  type FakeInstance = {
    configure: jest.Mock;
    generate: jest.Mock;
    delete: jest.Mock;
    interrupt: jest.Mock;
    setTokenCallback: jest.Mock;
  };
  const newInstance = (): FakeInstance => ({
    configure: jest.fn(),
    generate: jest.fn(
      async () => '{"isTransaction":true,"amountIndex":0,"direction":"expense","merchant":null}',
    ),
    delete: jest.fn(),
    interrupt: jest.fn(),
    setTokenCallback: jest.fn(),
  });

  /** Resolvers for the loads currently parked inside `fromModelName`, oldest first. */
  let pendingLoads: ((instance: FakeInstance) => void)[] = [];
  let liveLoads = 0;
  let maxLiveLoads = 0;

  /** Drains the microtask queue so parked promises can settle. */
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  beforeEach(() => {
    pendingLoads = [];
    liveLoads = 0;
    maxLiveLoads = 0;
    deleteResources.mockClear();
    // Every load parks until the test releases it, and the peak number parked
    // at once is the assertion that matters: two concurrent ~1GB loads OOM.
    fromModelName.mockImplementation(
      () =>
        new Promise<FakeInstance>((resolve) => {
          liveLoads += 1;
          maxLiveLoads = Math.max(maxLiveLoads, liveLoads);
          pendingLoads.push((instance) => {
            liveLoads -= 1;
            resolve(instance);
          });
        }),
    );
  });

  afterEach(() => {
    fromModelName.mockImplementation(async () => newInstance());
  });

  it('a Download tap joins a running load instead of starting a second one', async () => {
    settings.aiModelDownloaded = 'true';
    const load = ensureLoaded(db);
    await flush();
    expect(fromModelName).toHaveBeenCalledTimes(1);

    // Download is reachable during the load: it renders off the persistent flag.
    const download = downloadModel(db);
    await flush();
    expect(fromModelName).toHaveBeenCalledTimes(1);

    const loaded = newInstance();
    pendingLoads[0](loaded);
    await expect(load).resolves.toBe(true);
    await flush();

    // Only now does the download load — against freed RAM, not a second copy.
    expect(loaded.delete).toHaveBeenCalledTimes(1);
    expect(fromModelName).toHaveBeenCalledTimes(2);
    pendingLoads[1](newInstance());
    await download;

    expect(maxLiveLoads).toBe(1);
    expect(settings.aiModelDownloaded).toBe('true');
  });

  it('a Delete tap during a cold load waits for it, then frees what it loaded', async () => {
    settings.aiModelDownloaded = 'true';
    const load = ensureLoaded(db);
    await flush();

    const remove = deleteModel(db);
    await flush();
    // The files must survive until the load that is reading them is done.
    expect(deleteResources).not.toHaveBeenCalled();
    expect(settings.aiModelDownloaded).toBe('true');
    // …and nothing relights the model behind the teardown's back.
    await expect(ensureLoaded(db)).resolves.toBe(false);
    expect(fromModelName).toHaveBeenCalledTimes(1);

    const loaded = newInstance();
    pendingLoads[0](loaded);
    await load;
    await remove;

    // Without the join this instance is assigned after the teardown ran: ~1GB
    // resident for a model whose files are gone.
    expect(loaded.delete).toHaveBeenCalledTimes(1);
    expect(deleteResources).toHaveBeenCalledTimes(1);
    expect(settings.aiModelDownloaded).toBe('false');
    expect(getModelState()).toBe('absent');
  });

  it('a Delete tap during inference waits for generate() before freeing the handle', async () => {
    settings.aiModelDownloaded = 'true';
    const loaded = newInstance();
    let finishGenerate: ((reply: string) => void) | undefined;
    loaded.generate.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finishGenerate = resolve;
        }),
    );

    const load = ensureLoaded(db);
    await flush();
    pendingLoads[0](loaded);
    await load;

    const pendingClassify = classify(db, 'GCash: sent P100.00 to Aling Nena', [10000]);
    await flush();
    expect(loaded.generate).toHaveBeenCalledTimes(1);

    const remove = deleteModel(db);
    await flush();
    // Freeing here is a use-after-free on a live inference handle.
    expect(loaded.delete).not.toHaveBeenCalled();
    expect(deleteResources).not.toHaveBeenCalled();
    // A notification arriving mid-teardown gets no handle at all.
    await expect(classify(db, 'BPI: P50.00 debited', [5000])).resolves.toBeNull();
    expect(loaded.generate).toHaveBeenCalledTimes(1);

    finishGenerate!(
      '{"isTransaction":true,"amountIndex":0,"direction":"expense","merchant":"Aling Nena"}',
    );
    await remove;

    expect(loaded.delete).toHaveBeenCalledTimes(1);
    expect(deleteResources).toHaveBeenCalledTimes(1);
    // The inference ran to completion against a handle that was still valid, so
    // its answer stands — the teardown waited rather than killing it.
    await expect(pendingClassify).resolves.toEqual({
      isTransaction: true,
      amountCentavos: 10000,
      direction: 'expense',
      merchant: 'Aling Nena',
    });
  });

  /**
   * unload() (app background) can't wait — it is synchronous by contract. It
   * detaches immediately and queues the native free behind the inference, whose
   * answer is then stale: it describes a handle nothing holds any more.
   */
  it('unload mid-inference defers the native free and discards the late answer', async () => {
    settings.aiModelDownloaded = 'true';
    const loaded = newInstance();
    let finishGenerate: ((reply: string) => void) | undefined;
    loaded.generate.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finishGenerate = resolve;
        }),
    );

    const load = ensureLoaded(db);
    await flush();
    pendingLoads[0](loaded);
    await load;

    const pendingClassify = classify(db, 'GCash: sent P100.00 to Aling Nena', [10000]);
    await flush();

    unload();
    expect(getModelState()).toBe('absent');
    // Freeing now would pull native memory out from under generate().
    expect(loaded.delete).not.toHaveBeenCalled();

    finishGenerate!(
      '{"isTransaction":true,"amountIndex":0,"direction":"expense","merchant":"Aling Nena"}',
    );
    await expect(pendingClassify).resolves.toBeNull();
    await flush();
    expect(loaded.delete).toHaveBeenCalledTimes(1);
  });

  /**
   * unload() during a COLD LOAD is the common case, not an edge: DbProvider
   * fires syncNotifications on mount, that can start a multi-second load, and
   * the user backgrounds the app while it runs. Nothing is resident yet, so a
   * free that only looks at `modelInstance` frees nothing — and nothing
   * re-runs unload until the NEXT background transition, which needs a
   * foreground first. The app sits on ~1GB in the meantime.
   */
  it('an unload during a cold load frees the instance that load produces', async () => {
    settings.aiModelDownloaded = 'true';
    const load = ensureLoaded(db);
    await flush();
    expect(fromModelName).toHaveBeenCalledTimes(1);

    // AppState -> background. `fromModelName` has handed back no handle yet.
    unload();
    expect(getModelState()).toBe('absent');

    const loaded = newInstance();
    pendingLoads[0](loaded);
    await load;
    await flush();

    expect(loaded.delete).toHaveBeenCalledTimes(1);
    expect(getModelState()).toBe('absent');
    // Nothing is resident when the load reports back, so it must not claim to
    // have loaded one.
    await expect(load).resolves.toBe(false);
  });

  /**
   * A hold outliving its instance is routine, not a wedge: classifyWithLlm
   * abandons the inference after 5s while the native Qwen3-1.7B call runs on
   * for tens of seconds, and the hold is released off the NATIVE promise. Read
   * from one global set, that stale holder blocks the free of every instance
   * loaded afterwards — ~1GB leaked per background/foreground cycle.
   */
  it('a hold that outlives its instance does not block the next instance', async () => {
    settings.aiModelDownloaded = 'true';
    const a = newInstance();
    let finishA: ((reply: string) => void) | undefined;
    a.generate.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finishA = resolve;
        }),
    );

    const first = ensureLoaded(db);
    await flush();
    pendingLoads[0](a);
    await first;
    const pendingClassify = classify(db, 'GCash: sent P100.00 to Aling Nena', [10000]);
    await flush();
    expect(a.generate).toHaveBeenCalledTimes(1);

    // Background: A is detached with its inference still holding it.
    unload();
    await flush();
    expect(a.delete).not.toHaveBeenCalled();

    // Foreground again — a fresh classify relights the model into a NEW handle.
    const b = newInstance();
    const second = ensureLoaded(db);
    await flush();
    pendingLoads[1](b);
    await expect(second).resolves.toBe(true);

    // Backgrounded again while A's native call is still out there. B has no
    // inference of its own, so its free must not wait on anything.
    unload();
    await flush();
    expect(b.delete).toHaveBeenCalledTimes(1);

    // A's answer lands eventually; it describes a handle nothing holds now.
    finishA!('{"isTransaction":true,"amountIndex":0,"direction":"expense","merchant":"Aling Nena"}');
    await expect(pendingClassify).resolves.toBeNull();
    await flush();
    expect(a.delete).toHaveBeenCalledTimes(1);
  });

  /**
   * The permanent version of the same hazard: a native `generate()` that never
   * returns. Unbounded, it pins `deleteInFlight` for the rest of the session —
   * ensureLoaded then returns false and classify() null forever, while the UI
   * still renders AI parsing as on and the persistent flag still says 'true'.
   */
  it('a wedged inference cannot pin the teardown for the rest of the session', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      settings.aiModelDownloaded = 'true';
      const loaded = newInstance();
      loaded.generate.mockImplementation(() => new Promise<string>(() => {}));

      const load = ensureLoaded(db);
      await flush();
      pendingLoads[0](loaded);
      await load;
      const abandoned = classify(db, 'GCash: sent P100.00 to Aling Nena', [10000]);
      await flush();
      expect(loaded.generate).toHaveBeenCalledTimes(1);

      const remove = deleteModel(db);
      await flush();
      // Still inside the bound: the teardown is genuinely waiting.
      expect(deleteResources).not.toHaveBeenCalled();

      // classifyWithLlm's own 5s timeout fires in here and it gives up — but
      // the native call, and so the hold, is still out there.
      await jest.advanceTimersByTimeAsync(60_000);
      await expect(abandoned).resolves.toBeNull();
      const outcome = await Promise.race([
        remove.then(() => 'settled' as const),
        flush().then(() => 'pinned' as const),
      ]);
      expect(outcome).toBe('settled');

      // The handle is abandoned rather than freed — `.delete()` under a live
      // native call is a use-after-free — but the files and the flag do go.
      expect(loaded.delete).not.toHaveBeenCalled();
      expect(deleteResources).toHaveBeenCalledTimes(1);
      expect(settings.aiModelDownloaded).toBe('false');

      // And the feature is not dead: `deleteInFlight` cleared, so a later
      // download/load still works.
      settings.aiModelDownloaded = 'true';
      const relight = ensureLoaded(db);
      await flush();
      pendingLoads[1](newInstance());
      await expect(relight).resolves.toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  /**
   * classify() awaiting a multi-second cold load with Delete tapped in the
   * middle. Its `deleteInFlight` re-check is the only thing standing between a
   * teardown and a `generate()` on a handle that is about to be freed —
   * ensureLoaded's earlier bail cannot cover this, it already returned true.
   */
  it('a Delete tap during the cold load a classify is waiting on never reaches generate', async () => {
    settings.aiModelDownloaded = 'true';
    const pendingClassify = classify(db, 'GCash: sent P100.00 to Aling Nena', [10000]);
    await flush();
    expect(fromModelName).toHaveBeenCalledTimes(1);

    const remove = deleteModel(db);
    await flush();

    const loaded = newInstance();
    pendingLoads[0](loaded);
    await expect(pendingClassify).resolves.toBeNull();
    await remove;

    expect(loaded.generate).not.toHaveBeenCalled();
    expect(loaded.delete).toHaveBeenCalledTimes(1);
    expect(deleteResources).toHaveBeenCalledTimes(1);
  });

  /**
   * Interrupt is a request, not a guarantee — native may still be finishing when
   * the next item arrives, and LLMController.forward THROWS ModelGenerating on a
   * concurrent generate. The guard turns that exception path into a plain
   * fallback, and proves the interrupt is actually issued on the way out.
   */
  it('a still-running inference makes the next classify bail instead of stacking a second generate', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      settings.aiModelDownloaded = 'true';
      const loaded = newInstance();
      loaded.generate.mockImplementation(() => new Promise<string>(() => {}));

      const load = ensureLoaded(db);
      await flush();
      pendingLoads[0](loaded);
      await load;

      const abandoned = classify(db, 'GCash: sent P100.00 to Aling Nena', [10000]);
      await flush();
      expect(loaded.generate).toHaveBeenCalledTimes(1);

      // The hard cap fires with no token ever seen: classify gives up and asks
      // native to stop. `interrupt` returns at most one more token, so a real
      // runtime settles here — this fake never does, which is the worst case.
      await jest.advanceTimersByTimeAsync(12_000);
      await expect(abandoned).resolves.toBeNull();
      expect(loaded.interrupt).toHaveBeenCalledTimes(1);

      // Next item in the same drain. It must NOT touch generate again.
      await expect(classify(db, 'BPI: P50.00 debited', [5000])).resolves.toBeNull();
      expect(loaded.generate).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  /**
   * The other half of that guard: it keys off a hold that is still out, and a
   * hold is released off the INFERENCE promise rather than in classify's
   * `finally`. Back-to-back classifies in one drain must still both run, or the
   * guard would silently disable the model for every item after the first.
   */
  it('back-to-back classifies both run when each inference completes', async () => {
    settings.aiModelDownloaded = 'true';
    const loaded = newInstance();
    const load = ensureLoaded(db);
    await flush();
    pendingLoads[0](loaded);
    await load;

    await expect(classify(db, 'GCash: sent P100.00 to Aling Nena', [10000])).resolves.toEqual({
      isTransaction: true,
      direction: 'expense',
      merchant: null,
      amountCentavos: 10000,
    });
    await expect(classify(db, 'BPI: P50.00 debited', [5000])).resolves.toEqual({
      isTransaction: true,
      direction: 'expense',
      merchant: null,
      amountCentavos: 5000,
    });
    expect(loaded.generate).toHaveBeenCalledTimes(2);
  });

  it('a second Delete tap joins the running teardown', async () => {
    settings.aiModelDownloaded = 'true';
    const load = ensureLoaded(db);
    await flush();

    const first = deleteModel(db);
    const second = deleteModel(db);
    pendingLoads[0](newInstance());
    await load;
    await Promise.all([first, second]);

    expect(deleteResources).toHaveBeenCalledTimes(1);
  });
});
