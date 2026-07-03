# Kuripot — Filipino Expense/Income Tracker (Design Spec)

Date: 2026-07-03
Status: Approved by user (brainstorming session)

## Summary

An offline-first Android app (bundled as APK) for tracking income and expenses,
built for Filipino users. Working name: **Kuripot** (changeable). Money lives in
"buckets" (GCash, banks, cash on hand, etc.), expenses can be captured from
receipt photos via on-device OCR, recurring bills and Home Credit-style
installments post automatically, and a statistics page summarizes everything by
calendar month.

**Audience:** personal use now, designed to be publishable on the Play Store
later. **v1 is offline-only** — all data in a local SQLite database; no
accounts, no backend.

## Tech Stack

- **Expo (dev-build workflow) + React Native + TypeScript**
- **expo-sqlite + Drizzle ORM** — typed queries, migrations
- **Expo Router** — file-based tab navigation
- **expo-camera** — receipt capture
- **@react-native-ml-kit/text-recognition** — offline OCR (Google ML Kit)
- **expo-notifications** — local due-date notifications
- **Jest + React Native Testing Library** — tests
- **APK builds:** `eas build -p android --profile preview` (primary) or
  `npx expo run:android --variant release` (local fallback)

Note: ML Kit requires a custom dev build (not Expo Go). Development happens on
a physical device with a dev-build installed.

## Screens (5 tabs)

1. **Home** — total money across buckets, bucket cards with live balances,
   recent transactions, quick-add buttons (expense / income / transfer).
2. **Transactions** — full list; filter by bucket, category, month; tap to
   edit or delete. Add-expense flow includes a scan-receipt (camera) button.
3. **Recurring** — recurring expense list (rent, subscriptions, load) and
   installment plans (item name, monthly due, months left, remaining balance).
   Items auto-post on their due date.
4. **Utang** — two lists: *inutang ko* (I owe) and *pinautang ko* (owed to
   me), tracked per person, with partial payments.
5. **Stats** — calendar-month statistics (detailed below).

## Buckets

- Presets: **GCash, Maya, BDO, BPI, Cash on Hand, Alkansya**.
- User can add custom buckets: name, icon, color, starting balance.
- Every transaction belongs to a bucket; transfers move money between two
  buckets.
- **Balance is always derived**: startingBalance + Σ income − Σ expenses ±
  transfers, computed by query and never stored — balances cannot desync.
- Buckets with history are archived instead of deleted.

## Categories

Preset expense categories (editable, user can add more): Load, Pamasahe,
Kuryente, Tubig, Groceries, Kain sa labas, Padala, Internet, Rent,
Installment, Iba pa. Income categories separate (e.g., Freelance, Sideline,
Iba pa). Peso (₱) formatting everywhere.

## Data Model (SQLite via Drizzle)

- `buckets` — id, name, icon, color, startingBalance, archived
- `categories` — id, name, icon, type (`expense` | `income`)
- `transactions` — id, type (`expense` | `income` | `transfer`), amount
  (**integer centavos** — no floating point), bucketId, toBucketId (transfers
  only), categoryId, note, receiptPhotoUri, date, recurringId (set when
  auto-posted), createdAt
- `recurring` — id, name, amount, categoryId, bucketId, frequency
  (`monthly` | `weekly`), dayDue, startDate, endDate (null = forever), active
- `installments` — id, itemName (e.g., "Home Credit — TV"), totalAmount,
  monthlyDue, monthsTotal, monthsPaid, dayDue, bucketId, startDate. Each
  auto-posted payment increments monthsPaid; the plan completes itself when
  monthsPaid reaches monthsTotal.
- `utang` — id, personName, direction (`iOwe` | `owedToMe`), originalAmount,
  note, createdAt
- `utang_payments` — id, utangId, amount, date, bucketId (payments move real
  money through a bucket)

## Recurring & Installment Posting

- On app open, a **catch-up job** scans for due recurring items and
  installment payments since the last run and inserts the corresponding
  transactions (flagged as auto-posted via recurringId).
- Works after being offline/closed for days: all missed due dates post.
- Month-end handling: a due day of 29–31 posts on the last day of shorter
  months.
- Auto-posted transactions are editable and deletable like any other.
- A local notification fires on the due date (e.g., "Kuryente ₱1,800 posted").

## Receipt OCR Flow

1. Add expense → tap camera → capture receipt with expo-camera.
2. ML Kit text recognition runs **on-device** (offline).
3. A parser extracts: the amount (prefers a TOTAL/AMOUNT DUE line, falls back
   to the largest peso amount found) and a merchant guess from the top lines.
4. The add-expense form is **pre-filled, never auto-saved** — the user always
   confirms or edits before saving.
5. The photo is stored in app storage; the transaction shows a thumbnail.
6. If OCR finds nothing, the form stays blank but the photo is still attached
   — OCR failure never blocks logging.

## Stats Page (calendar month)

- Month picker, defaulting to the current month.
- Headline numbers: total money (all buckets), month income, month expenses,
  net (green/red).
- Per-bucket balance list.
- Expense donut chart by category + top-5 categories with percentages.
- 6-month bar trend: income vs expenses side by side.
- Utang summary: total I owe vs total owed to me.

## Error Handling

- Amounts validated as positive; stored as integer centavos.
- Deleting a bucket with transactions archives it instead (history preserved).
- OCR failure falls back to manual entry.
- Schema changes ship as Drizzle migrations so app updates never lose data.

## Testing

Jest + React Native Testing Library:

- Unit: money math (centavos), balance derivation, recurring catch-up
  (including month-end edge cases like a due day of 31 in February),
  installment completion, receipt parser against sample PH receipt texts
  (SM, 7-Eleven, Mercury Drug).
- Component: add-expense form flow.

## Out of Scope (v1)

Cloud sync and accounts, iOS build, budgets/spending limits, sahod-cycle
(kinsenas/katapusan) stats view, bank feed imports, AI/cloud receipt
extraction.
