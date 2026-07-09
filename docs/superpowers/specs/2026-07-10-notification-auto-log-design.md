# Notification Auto-Log — Design

**Date:** 2026-07-10
**Status:** Approved (brainstorm)

## Goal

Auto-log expenses/incomes in Kuripot from Android notifications posted by bank and
e-wallet apps (credit cards, GCash, etc.). Replaces earlier Gmail-reading idea —
notification listener is realtime, needs no OAuth/Google verification, works offline.

## Scope

- **Android only.** iOS has no API for reading other apps' notifications; the module
  no-ops on iOS and the settings UI hides the feature.
- Any bucket type can be a target (credit cards and regular buckets like GCash).
- Expense and income detection only; transfers out of scope v1 (GCash "send money"
  logs as expense).
- Requires custom dev build (already the norm for this repo — native ML Kit dep).

## Known limitations (accepted)

- Notifications arriving while the listener service is dead (phone off, OEM battery
  killer on Xiaomi/Huawei-class ROMs) are lost. No history API.
- No true background timer: 2-day expiry is evaluated on app open, so auto-commit
  happens on the first open after the deadline.
- No live sync while app closed: captures buffer natively and ingest on next
  foreground.

## Architecture

### Native piece — custom Expo Module (Kotlin)

`NotificationListenerService`:

- Filters incoming notifications by the set of mapped package names (pushed down
  from JS whenever mappings change).
- Appends `{package, title, text, postedAt, key}` as JSON lines to a native-side
  buffer file.
- Survives app death; user grants the special "Notification access" permission once
  via system settings (module exposes `openSettings()` + `isPermissionGranted()`).
- When the RN app is alive, also emits a live event so ingest is immediate.

Chosen over `react-native-android-notification-listener` (stale, new-arch/RN 0.86
gamble, headless-JS flakiness) and automation-app bridges (fragile, not in-app).

### JS ingest flow

```
app foregrounded → read buffer file, clear it
  → dedup by notification key
  → notificationParser.ts → {amountCentavos, merchant, direction, confidence}
  → high confidence → insert transaction directly (tagged with source)
  → medium confidence → pending_notifications (inbox)
  → no amount → discard
  → then: expire pending items older than 2 days
      (has amount → commit; no amount → discard)
```

### Parser — `src/lib/notificationParser.ts`

Pure function, mirrors `receiptParser.ts` style. Unit-tested against real sample
notification strings (collected from user's devices at implementation time).

- Amount: regex set for PHP formats — `PHP 1,234.56`, `₱1,234.56`, etc. → integer
  centavos (matches money convention in schema).
- Direction: verb lists — paid/spent/purchase = expense; received/refund/cashback
  = income.
- Merchant: extraction between known per-format markers.
- Confidence: amount + verb = **high** (auto-commit); amount only = **medium**
  (inbox); no amount = **discard**.

### Categories — keyword rules

`category_rules` table: keyword → category, priority-ordered, first match against
merchant/notification text wins; no match = uncategorized. Managed in settings.

## Schema (new)

- `notification_sources`: id, bucketId FK, packageName, matchKeyword (nullable,
  e.g. card last-4 for multi-card same app), enabled.
- `pending_notifications`: id, sourceId FK, rawTitle, rawText, parsedAmount,
  parsedMerchant, parsedType, notifKey (unique — dedup), postedAt,
  status enum pending/committed/discarded.
- `category_rules`: id, keyword, categoryId FK, priority.
- `transactions`: new nullable `sourceNotifKey` column for dedup/traceability.

## UI

- **Settings — "Auto-log" section:** permission status + button opening the system
  Notification-access screen; mapping list (add: pick bucket, pick source app,
  optional keyword); category rules list.
- **Inbox:** entry point on transactions tab with pending-count badge. Row =
  merchant + amount + source bucket. Tap = prefilled edit form (confirm/edit);
  swipe = discard.

## Decisions log

- Explicit bucket↔package mapping over fuzzy name matching (avoids ghost entries
  from promo notifications).
- Hybrid commit: high-confidence auto-commit, rest to inbox, untouched inbox items
  auto-commit after 2 days (discard if no amount).
- Keyword category rules (user choice) over per-mapping defaults or
  uncategorized-only.
