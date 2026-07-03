# Kuripot 🐷

Offline-first na expense tracker para sa Pinoy. Log your gastos and kita, track
money per bucket (GCash, Maya, banko, cash on hand), scan resibo with the
camera, remember utang, and never miss a recurring bill or hulugan.

## Features

- **Buckets** — money tracked per wallet/bank with derived balances (never stored,
  always computed from transactions). PH presets: Cash on Hand, GCash, Maya,
  BDO, BPI, Alkansya.
- **Expenses / income / transfers** — all amounts are integer centavos; PH
  categories (Load, Pamasahe, Kuryente, Kain sa labas, Padala, …).
- **Recurring expenses** — monthly or weekly rules; a catch-up engine posts any
  missed dues when you open the app (month-end days clamp correctly, e.g. due
  day 31 posts on Feb 28) and a local notification tells you what posted.
- **Hulugan (installments)** — Home Credit-style plans with monthly due,
  remaining balance, and months left.
- **Utang tracker** — both directions (utang ko / utang sa akin); payments are
  real bucket transactions.
- **Receipt scanning** — camera → on-device ML Kit OCR → parsed total and
  merchant prefill the add-expense form. Fully offline; nothing auto-saves.
- **Stats** — calendar-month income/expenses/net, category donut, 6-month
  trend, per-bucket balances, utang totals.

Everything is stored locally in SQLite. No account, no internet needed.

## Stack

- Expo SDK 57 (dev-build workflow — ML Kit needs native code, Expo Go won't work)
- expo-router, React Native 0.86, TypeScript
- expo-sqlite + Drizzle ORM (migrations in `drizzle/`)
- `@react-native-ml-kit/text-recognition` for offline OCR
- Jest: `logic` project (ts-jest + better-sqlite3 in-memory DB running the real
  migrations) and `ui` project (jest-expo + Testing Library)

## Development

```bash
npm install
npm test               # all tests
npm test -- --selectProjects logic
npx tsc --noEmit       # typecheck
npx expo run:android   # dev build on device/emulator
```

## Building the APK

```bash
# Cloud build (needs an Expo account):
npx eas build -p android --profile preview

# Or fully local:
npx expo run:android --variant release
```

The preview profile in `eas.json` produces an installable `.apk` (not an
`.aab`), signed for sideloading.

## Project layout

```
src/app/          expo-router screens (tabs + modals)
src/components/   form kit, bucket/transaction cards
src/db/           schema, migrations client, repos, seeds, DbProvider
src/lib/          money math, recurring engine, receipt parser, OCR, notifications
drizzle/          generated SQL migrations
docs/superpowers/ design spec and implementation plan
```
