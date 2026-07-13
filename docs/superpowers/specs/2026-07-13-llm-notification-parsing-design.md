# On-Device LLM Notification Parsing — Design

**Date:** 2026-07-13
**Status:** Approved (brainstorm)

## Goal

Generalize notification auto-log beyond hand-tuned regexes: when the regex parser
can't determine transaction direction, a small on-device LLM classifies direction
and extracts the merchant. Fully local — bank notification text never leaves the
device. Long-term, this is the planned premium feature (free = regex + inbox,
premium = AI parsing); this iteration builds the capability behind a settings
toggle, no billing.

## Decisions (from brainstorm)

- **Fallback-only**: LLM runs only when regex confidence is `medium` (amount
  found, direction unknown). Regex `high` commits instantly without LLM; regex
  `none` (no amount) is discarded without LLM — the model must never invent an
  amount (hallucinated money is worse than a missed log).
- **LLM results auto-commit**: a successful LLM classification upgrades the item
  to high confidence and commits, same trust level as regex. Inbox + 2-day expiry
  flow unchanged for items the LLM can't resolve.
- **Runtime**: `react-native-executorch` (Software Mansion). Chosen over llama.rn
  for declarative API, curated pre-exported models, Expo setup guide, and vendor
  overlap with existing deps (reanimated/screens). llama.rn is the fallback if a
  blocking incompatibility surfaces in the spike.
- **Model**: Qwen 3 1.7B (quantized, ~1GB download) — user device has 8GB+ RAM.
  If latency/RAM disappoints on device, drop to Qwen 3 0.6B without design change.
- **Android-only in practice** (whole auto-log feature is), but llmParser itself
  is platform-neutral JS.

## Architecture

### 1. `src/lib/llmParser.ts`

- Builds a single-turn prompt: sanitized notification text + the regex-extracted
  amount, asking for strict JSON `{"direction": "expense"|"income"|"unknown",
  "merchant": string|null}`.
- Parses/validates the model output hard: malformed JSON, unexpected fields,
  unknown direction, or >5s timeout → returns `null`.
- Pure orchestration over an injected `runInference(prompt) => Promise<string>`
  function — unit-testable with mocks, no native import in the module itself.

### 2. Pipeline integration (`src/db/notificationRepo.ts` ingest path)

```
regex high   → commit (unchanged, no LLM)
regex medium → LLM available+enabled?
                 yes → classify → direction != unknown
                         → upgrade: commit txn (LLM merchant as note fallback)
                         → pending row status 'committed'
                       direction unknown/null → inbox (as today)
                 no  → inbox (as today)
regex none   → store discarded (unchanged, no LLM)
```

LLM call happens inside the existing serialized ingest chain, so no new races.

### 3. Model manager

- Settings → Auto-log gains an "AI parsing (beta)" section:
  - Download model button showing approximate size, "Wi-Fi recommended" note,
    progress indicator; delete-model button; enable/disable toggle.
  - Toggle state in a small `app_settings` key-value table (new) or existing
    storage pattern — implementation picks the repo's established mechanism.
- react-native-executorch handles model fetch + cache; UI reflects its states.

### 4. Inference lifecycle

- Single module-level controller; model lazy-loads on first medium-confidence
  item (not at app start — RAM), unloads on app background.
- **Spike task first**: verify executorch exposes an imperative (non-hook) API
  usable from the ingest path; fallback = headless component mounted in
  DbProvider that exposes the controller via a module singleton.

### 5. Testing

- Unit: prompt construction, JSON validation, timeout, all llmParser branches
  with mocked `runInference`; ingest-path upgrade/fallback branches with a
  mocked llmParser.
- On-device: real inference correctness (BPI/Atome/Instapay samples) verified
  manually; not in jest.

## Out of scope

- Billing/premium gating (toggle is the seam).
- iOS. Cloud inference. Model choice UI (one model hardcoded).
- LLM for amount extraction or for regex-`none` items.
