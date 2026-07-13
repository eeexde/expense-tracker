# On-Device LLM Notification Parsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the regex parser finds an amount but not a direction (medium confidence), an on-device LLM (react-native-executorch + Qwen 3 1.7B) classifies direction + merchant and the item auto-commits; otherwise behavior is unchanged. Spec: `docs/superpowers/specs/2026-07-13-llm-notification-parsing-design.md`.

**Architecture:** Pure `llmParser.ts` (prompt build + strict JSON validation over an injected inference fn) → module-singleton `llmController.ts` (lazy model load via executorch's imperative `LLMModule`, unload on background) → optional `llmClassify` parameter threaded into `ingestCaptured`'s medium branch → "AI parsing (beta)" section in the auto-log settings screen with download/progress/toggle/delete. New `app_settings` KV table stores the toggle.

**Tech Stack:** react-native-executorch 0.9.x (+ react-native-executorch-expo-resource-fetcher, expo-asset; expo-file-system already installed), drizzle migration 0005, jest `logic` project for pure/db tests.

**Conventions (repo law — see CLAUDE.md):**
- Money integer centavos; `type Db = any` in repos; tests beside code; run `npm test -- --testPathIgnorePatterns=".claude"` from repo root.
- NO test files under `src/app/` (breaks Metro bundle on EAS). Screen tests → `src/__tests__/`.
- Migrations via `npx drizzle-kit generate` only. New tables MUST be added to `TABLES` in `src/db/dataTransfer.ts` (FK-safe order) + `OPTIONAL_TABLES` if restore of old backups must succeed (it must).
- All native touches stay in dedicated glue files (`notificationSync.ts` pattern) so everything else stays jest-testable.
- executorch requires Android 13+: every entry point must no-op/hide below that (use `Platform.Version`).

---

### Task 1: Dependencies + compatibility spike

**Files:**
- Modify: `package.json` (via npm install)
- Possibly modify: `app.json`, `jest.config.js` (only if verification forces it)

- [ ] **Step 1: Install**

```bash
npm install react-native-executorch react-native-executorch-expo-resource-fetcher expo-asset
```

- [ ] **Step 2: Verify imperative API exists in the installed version**

Read `node_modules/react-native-executorch/` exports (package.json `main`/`exports`, then the referenced files) and confirm: (a) an imperative `LLMModule` (or equivalently usable non-hook controller) with load/generate/unload/download-progress, (b) model constants for Qwen 3 (e.g. `models.llm.qwen3_1_7b()` or similar — note EXACT name and what it returns), (c) how download progress is exposed imperatively. Record findings as comments in the Task 3 controller. If NO imperative path exists, STOP and report BLOCKED with the exact exports found — the fallback design (headless component in DbProvider) needs coordinator sign-off.

- [ ] **Step 3: Verify toolchain still green**

Run: `npx tsc --noEmit && npm test -- --testPathIgnorePatterns=".claude"`
Expected: clean / all suites pass. If jest chokes on the new package's ESM, add a `transformIgnorePatterns` entry to the ui project in `jest.config.js` (mirror existing pattern) — logic project shouldn't touch it.

Run: `npx expo export --platform android --output-dir "%TEMP%\bundle-check-llm"` (or `$TEMP` in bash)
Expected: bundle succeeds (this is the phase that catches Metro-level breakage before EAS does).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json app.json jest.config.js
git commit -m "chore: add react-native-executorch for on-device LLM parsing"
```

(Only add files actually changed.)

---

### Task 2: llmParser (pure) — TDD

**Files:**
- Create: `src/lib/llmParser.ts`
- Test: `src/lib/llmParser.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/llmParser.test.ts
import { buildPrompt, classifyWithLlm, parseLlmReply } from './llmParser';

describe('buildPrompt', () => {
  it('includes the notification text and formatted amount', () => {
    const p = buildPrompt('You have an incoming transfer of PHP 15,337.00', 1533700);
    expect(p).toContain('You have an incoming transfer');
    expect(p).toContain('15,337.00');
    expect(p).toMatch(/JSON/);
  });
});

describe('parseLlmReply', () => {
  it('accepts a clean JSON reply', () => {
    expect(parseLlmReply('{"direction":"income","merchant":"METROBANK"}')).toEqual({
      direction: 'income',
      merchant: 'METROBANK',
    });
  });

  it('accepts JSON wrapped in prose or code fences', () => {
    expect(
      parseLlmReply('Sure! ```json\n{"direction":"expense","merchant":null}\n```'),
    ).toEqual({ direction: 'expense', merchant: null });
  });

  it('rejects unknown direction, malformed JSON, and missing fields', () => {
    expect(parseLlmReply('{"direction":"transfer","merchant":"X"}')).toBeNull();
    expect(parseLlmReply('not json at all')).toBeNull();
    expect(parseLlmReply('{"merchant":"X"}')).toBeNull();
  });

  it('treats direction "unknown" as null result', () => {
    expect(parseLlmReply('{"direction":"unknown","merchant":null}')).toBeNull();
  });

  it('coerces non-string merchant to null and trims overlong merchants', () => {
    expect(parseLlmReply('{"direction":"income","merchant":42}')).toEqual({
      direction: 'income',
      merchant: null,
    });
    const long = 'X'.repeat(80);
    expect(parseLlmReply(`{"direction":"income","merchant":"${long}"}`)!.merchant).toHaveLength(60);
  });
});

describe('classifyWithLlm', () => {
  it('returns parsed result from the injected runner', async () => {
    const run = jest.fn().mockResolvedValue('{"direction":"income","merchant":"MB"}');
    await expect(classifyWithLlm(run, 'text', 100)).resolves.toEqual({
      direction: 'income',
      merchant: 'MB',
    });
    expect(run).toHaveBeenCalledWith(expect.stringContaining('text'));
  });

  it('returns null on runner rejection', async () => {
    const run = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(classifyWithLlm(run, 'text', 100)).resolves.toBeNull();
  });

  it('returns null when the runner exceeds the timeout', async () => {
    jest.useFakeTimers();
    const run = jest.fn(() => new Promise<string>(() => {}));
    const promise = classifyWithLlm(run, 'text', 100);
    jest.advanceTimersByTime(6000);
    await expect(promise).resolves.toBeNull();
    jest.useRealTimers();
  });
});
```

- [ ] **Step 2: Run, verify failure** — `npm test -- --testPathIgnorePatterns=".claude" --testPathPattern="llmParser"` → module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/llmParser.ts
import { formatPeso } from './money';

export interface LlmClassification {
  direction: 'expense' | 'income';
  merchant: string | null;
}

/** Inference runner injected by the controller; resolves to raw model text. */
export type RunInference = (prompt: string) => Promise<string>;

const TIMEOUT_MS = 5000;
const MERCHANT_MAX = 60;

/**
 * Single-turn prompt. The amount is regex-extracted and included only as
 * context — the model is never asked for numbers (hallucinated money is worse
 * than a missed log).
 */
export function buildPrompt(notificationText: string, amountCentavos: number): string {
  return [
    'You classify bank/e-wallet transaction notifications.',
    `The transaction amount is ${formatPeso(amountCentavos)}.`,
    'Decide if the account owner SPENT money (expense) or RECEIVED money (income),',
    'and extract the merchant or counterparty name if present.',
    'Reply with ONLY this JSON, nothing else:',
    '{"direction":"expense"|"income"|"unknown","merchant":string|null}',
    '',
    'Notification:',
    notificationText,
  ].join('\n');
}

/** Strict validation — anything off-contract returns null (item stays in inbox). */
export function parseLlmReply(raw: string): LlmClassification | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const direction = (parsed as Record<string, unknown>).direction;
  if (direction !== 'expense' && direction !== 'income') return null;
  const rawMerchant = (parsed as Record<string, unknown>).merchant;
  const merchant =
    typeof rawMerchant === 'string' && rawMerchant.trim()
      ? rawMerchant.trim().slice(0, MERCHANT_MAX)
      : null;
  return { direction, merchant };
}

/** Never throws; null means "LLM couldn't help" and the caller falls back. */
export async function classifyWithLlm(
  run: RunInference,
  notificationText: string,
  amountCentavos: number,
): Promise<LlmClassification | null> {
  try {
    const reply = await Promise.race([
      run(buildPrompt(notificationText, amountCentavos)),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('llm timeout')), TIMEOUT_MS),
      ),
    ]);
    return parseLlmReply(reply);
  } catch {
    return null;
  }
}
```

Check `formatPeso`'s exact formatting in `src/lib/money.ts` first; if it prefixes ₱ with different separators than the test expects, align the TEST assertion (`15,337.00`) with reality — the prompt just needs a readable amount.

- [ ] **Step 4: Run tests** — parser file green, then whole logic project green.

- [ ] **Step 5: Commit** — `feat: llm classification prompt + strict reply validation`

---

### Task 3: app_settings table + llmController glue

**Files:**
- Modify: `src/db/schema.ts` (+ migration via drizzle-kit)
- Modify: `src/db/dataTransfer.ts` (TABLES + OPTIONAL_TABLES)
- Create: `src/db/settingsRepo.ts` + `src/db/settingsRepo.test.ts`
- Create: `src/lib/llmController.ts` (native glue — NO unit tests, keep every executorch import here)

- [ ] **Step 1 (TDD): settings repo tests**

```ts
// src/db/settingsRepo.test.ts
import { createTestDb } from './testDb';
import { getSetting, setSetting } from './settingsRepo';

describe('settingsRepo', () => {
  it('returns null for unset keys and round-trips values', async () => {
    const db = createTestDb();
    expect(await getSetting(db, 'aiParsingEnabled')).toBeNull();
    await setSetting(db, 'aiParsingEnabled', 'true');
    expect(await getSetting(db, 'aiParsingEnabled')).toBe('true');
    await setSetting(db, 'aiParsingEnabled', 'false');
    expect(await getSetting(db, 'aiParsingEnabled')).toBe('false');
  });
});
```

- [ ] **Step 2: Schema + migration**

```ts
/** Small app-level key/value settings (e.g. AI parsing toggle). */
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
```

Type export `AppSetting`. Run `npx drizzle-kit generate` → migration 0005. Add `{ key: 'appSettings', table: appSettings }` to `TABLES` in dataTransfer (no FKs — order flexible; put it first) AND to `OPTIONAL_TABLES` (old backups lack it). Extend the dataTransfer round-trip test to cover it (follow the existing notification-tables test pattern).

- [ ] **Step 3: settingsRepo implementation**

```ts
// src/db/settingsRepo.ts
import { eq } from 'drizzle-orm';
import { appSettings } from './schema';

type Db = any;

export async function getSetting(db: Db, key: string): Promise<string | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
  return row?.value ?? null;
}

export async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } });
}
```

- [ ] **Step 4: llmController**

Shape (adjust to the EXACT executorch API found in Task 1 — that spike's findings override this sketch):

```ts
// src/lib/llmController.ts
// All react-native-executorch imports live HERE and nowhere else.
import { Platform } from 'react-native';
import { classifyWithLlm, LlmClassification } from './llmParser';

export const llmSupported = Platform.OS === 'android' && Number(Platform.Version) >= 33;

export type LlmModelState = 'absent' | 'downloading' | 'ready' | 'loading' | 'error';

// Singleton wrapping executorch's imperative LLMModule:
// - downloadModel(onProgress): fetch Qwen 3 1.7B via the library's model constant
// - deleteModel(): remove cached files
// - getModelState(): LlmModelState (persisted presence check via library API/FS)
// - classify(text, amountCentavos): Promise<LlmClassification | null>
//     lazy-loads the model on first call, then delegates to
//     classifyWithLlm(runner, text, amount) with generation config
//     { temperature: 0 } (deterministic) and a fresh single-turn context.
// - unload(): free model RAM; DbProvider calls this on AppState 'background'.
```

Every public function guards on `llmSupported` and returns inert values off-support.

- [ ] **Step 5: Verify** — logic tests green, `npx tsc --noEmit` clean, `npx expo export --platform android` still bundles.

- [ ] **Step 6: Commit** — `feat: app settings table + llm controller glue`

---

### Task 4: Ingest integration — TDD

**Files:**
- Modify: `src/db/notificationRepo.ts` (`ingestCaptured` optional classifier param)
- Modify: `src/db/notificationRepo.test.ts`
- Modify: `src/lib/notificationSync.ts` (thread the classifier in)

- [ ] **Step 1: Failing tests**

Add to notificationRepo.test.ts:

```ts
describe('LLM fallback on medium confidence', () => {
  const NOW = '2026-07-13T08:00:00.000Z';
  const mediumEntry = {
    packageName: 'com.globe.gcash.android',
    title: null,
    text: 'Transaction alert: PHP 99.00 JOLLIBEE ref 555',
    postedAt: NOW,
    key: 'llm1',
  };

  it('classifier direction upgrades a medium item to committed', async () => {
    const db = createTestDb();
    await setup(db);
    const classify = jest.fn().mockResolvedValue({ direction: 'income', merchant: 'JOLLIBEE' });
    const summary = await ingestCaptured(db, [mediumEntry], NOW, classify);
    expect(classify).toHaveBeenCalledWith(mediumEntry.text, 9900);
    expect(summary.committed).toBe(1);
    expect(summary.queued).toBe(0);
    const [txn] = await db.select().from(transactions);
    expect(txn.type).toBe('income');
    expect(txn.note).toBe('JOLLIBEE');
    const [row] = await db.select().from(pendingNotifications);
    expect(row.status).toBe('committed');
  });

  it('classifier null keeps the item in the inbox', async () => {
    const db = createTestDb();
    await setup(db);
    const classify = jest.fn().mockResolvedValue(null);
    const summary = await ingestCaptured(db, [mediumEntry], NOW, classify);
    expect(summary.queued).toBe(1);
    expect(await db.select().from(transactions)).toHaveLength(0);
  });

  it('classifier is not called for high or no-amount items', async () => {
    const db = createTestDb();
    await setup(db);
    const classify = jest.fn();
    await ingestCaptured(
      db,
      [
        { ...mediumEntry, key: 'llm2', text: 'You have sent PHP 10.00 to X.' },
        { ...mediumEntry, key: 'llm3', text: 'Promo! 20% off this weekend' },
      ],
      NOW,
      classify,
    );
    expect(classify).not.toHaveBeenCalled();
  });

  it('classifier throwing does not break ingest — item queues', async () => {
    const db = createTestDb();
    await setup(db);
    const classify = jest.fn().mockRejectedValue(new Error('native crash'));
    const summary = await ingestCaptured(db, [mediumEntry], NOW, classify);
    expect(summary.queued).toBe(1);
  });
});
```

(`setup` helper already exists in the file. Import `ingestCaptured` etc. as already imported.)

- [ ] **Step 2: Verify failure** (signature mismatch / behavior missing).

- [ ] **Step 3: Implement**

In `notificationRepo.ts`:

```ts
/** Optional LLM fallback; called only for medium-confidence items. */
export type LlmClassifier = (
  text: string,
  amountCentavos: number,
) => Promise<{ direction: 'expense' | 'income'; merchant: string | null } | null>;
```

`ingestCaptured(db, captured, nowIso, llmClassify?: LlmClassifier)`: in the medium branch, when `llmClassify` provided, call inside try/catch; on a non-null result, build the parsed row with the LLM's direction (and its merchant when regex merchant is null), insert the transaction via the existing `insertParsedTransaction`, write the pending row with status 'committed'; on null/throw fall through to the existing 'pending' path. Type the merge so `parsedType`/`parsedMerchant` reflect what was actually committed (audit row shows the LLM's answer).

In `notificationSync.ts`: build the classifier from the controller and thread it:

```ts
import { classify, llmEnabled } from './llmController'; // llmEnabled reads the app_settings toggle + model ready state
// inside syncNotifications / live path:
const llmClassify = (await llmEnabled(db)) ? classify : undefined;
const ingest = await ingestCaptured(db, captured, nowIso, llmClassify);
```

(Exact `llmEnabled` naming/signature per Task 3's actual controller; keep the DB read for the toggle in the controller so sync stays thin.)

- [ ] **Step 4: Wire model unload on background**

In `src/db/DbProvider.tsx`'s existing `AppState` listener effect, add alongside the `'active'` branch:

```ts
if (state === 'background') {
  unloadLlm(); // from '@/lib/llmController' — frees model RAM; no-op when not loaded
}
```

(Name per Task 3's actual controller export.)

- [ ] **Step 5: All logic tests green; tsc clean.**

- [ ] **Step 6: Commit** — `feat: llm fallback upgrades medium-confidence captures`

---

### Task 5: Settings UI — "AI parsing (beta)"

**Files:**
- Modify: `src/app/auto-log.tsx`

- [ ] **Step 1: Build the section** (below Category rules; follow the screen's existing section/card/pill styles):

1. Hidden entirely when `!llmSupported` (Android <13 / iOS).
2. Model absent: "Download AI model (~1 GB — Wi-Fi recommended)" button → `downloadModel(onProgress)`; progress bar (existing style vocabulary; simple `<View>` width-percentage bar is fine); errors → two-arg `Alert.alert('Could not download', message)`.
3. Model ready: toggle "Parse with AI when rules fail" wired to `getSetting/setSetting('aiParsingEnabled')` + `refresh()`; "Delete model" button with confirm Alert → `deleteModel()`.
4. One-line explainer: "Runs entirely on this phone. Used only when the regular parser can't tell expense from income."

- [ ] **Step 2: Verify** — tsc clean, full jest green, `npx expo export --platform android` bundles.

- [ ] **Step 3: Commit** — `feat: AI parsing section in auto-log settings`

---

### Task 6: On-device verification + EAS build (manual, with user)

- [ ] `npx expo run:android` or EAS preview build (executorch native code first compiles here — fix and commit anything it surfaces).
- [ ] Download model on device (Wi-Fi), watch progress, confirm ready state persists across app restart.
- [ ] Enable toggle. Send a medium-confidence email via Gmail (amount, no known verb — e.g. "Transaction alert: PHP 55.00 SOMESTORE ref 1"): expect auto-committed transaction with LLM direction rather than inbox.
- [ ] Verify the three real formats (Atome/BPI QR/Instapay) still commit via regex fast path (no LLM latency).
- [ ] Disable toggle → same email shape goes to inbox. Delete model → section returns to download state.
- [ ] `npx eas-cli build --platform android --profile preview` → green → install → smoke test.

## Out of scope (per spec)

Billing/premium gating; iOS; cloud inference; model choice UI; LLM on no-amount items.
