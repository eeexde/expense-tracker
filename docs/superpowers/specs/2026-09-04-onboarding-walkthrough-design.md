# First-run onboarding walkthrough — design

Date: 2026-09-04

## Problem

Kuripot launches straight to the Home tab with no explanation. A
first-time user sees five tabs (Home, Transactions, Recurring, Utang,
Stats) and a set of app-specific concepts — buckets, fallback chains,
installments, utang, the notification inbox — with nothing telling them
what any of it is for. There is no first-run, welcome, or help surface
anywhere in the app today.

## Goal

A coachmark-style guided tour that runs once on first launch: a dimmed
overlay with a spotlight cutout around a real on-screen element, a short
explanation card, and Back / Next / Skip controls. Replayable later from
Settings.

## Non-goals

- No navigation into add/edit modals, and no per-field coaching. The
  tour explains *what a screen is for*, not how to fill a form.
- No light-theme variant — the app is dark-only (`src/theme.ts`).
- No per-feature "new in this version" tips. One tour, one flag.
- No analytics.

## Architecture

New module `src/onboarding/` (four files) plus one pure-logic file in
`src/lib/`.

### `tourSteps.ts`

The step list as data. One entry per step:

```ts
type TourStep = {
  id: string;              // stable, used as test id and registry key
  tab?: TabRoute;          // route to navigate to before showing the step
  targetId?: string;       // registered target to spotlight; absent = centered card
  title: string;
  body: string;            // 1–2 sentences
  placement?: 'above' | 'below' | 'auto';  // tooltip side, default 'auto'
};
```

Steps (12):

| # | tab | target | subject |
|---|-----|--------|---------|
| 1 | home | — | Welcome: what Kuripot is |
| 2 | home | `home.total` | Total money hero |
| 3 | home | `home.buckets` | Buckets = envelopes your money sits in |
| 4 | home | `home.recent` | Recent transactions |
| 5 | home | `home.add` | Add a transaction |
| 6 | home | `home.settings` | Settings gear: backup, auto-log |
| 7 | transactions | `tab.transactions` | Filter and browse history |
| 8 | transactions | `transactions.inbox` | Notification inbox badge |
| 9 | recurring | `tab.recurring` | Recurring rules vs installments |
| 10 | utang | `tab.utang` | Debts you owe / are owed |
| 11 | stats | `tab.stats` | Charts and trends |
| 12 | home | — | Done: replay from Settings any time |

Tab-bar targets (`tab.*`) are registered by `src/app/(tabs)/_layout.tsx`
so the spotlight can point at the tab button itself as the tour moves
between screens.

### `src/lib/tourMachine.ts`

Pure reducer, no React and no React Native imports. It lives under
`src/lib/` because the `logic` jest project's `testRegex` only matches
`src/(lib|db)/**/*.test.ts` — a reducer test under `src/onboarding/`
would be picked up by no project at all.

```ts
type TourState = { active: boolean; index: number; completed: boolean };
type TourAction = { type: 'start' } | { type: 'next' } | { type: 'back' }
                | { type: 'skip' } | { type: 'finish' };
tourReducer(state, action, stepCount): TourState
```

Rules: `next` past the last step finishes; `back` at index 0 is a no-op;
`skip` and `finish` both set `active: false, completed: true`.

### `TourProvider.tsx`

React context. Holds the machine state via `useReducer`, plus a mutable
registry `Map<targetId, Rect>` of measured targets.

- Exposes `{ state, step, stepCount, next, back, skip, start, registerTarget, unregisterTarget }`.
- On step change, if `step.tab` differs from the current tab, calls
  `router.navigate` to that tab, then waits for `step.targetId` to appear
  in the registry.
- Rect resolution has a 600ms timeout. If the target never registers
  (screen still mounting, element scrolled out, element conditionally
  rendered), the overlay falls back to the centered-card layout for that
  step rather than blocking the tour.
- Start gate: on DB ready, read `getSetting(db, 'onboardingCompleted')`;
  if null, dispatch `start`. On `skip`/`finish`, write
  `setSetting(db, 'onboardingCompleted', 'true')`.

### `TourTarget.tsx`

```tsx
<TourTarget id="home.buckets">{children}</TourTarget>
```

A `View` that, on layout, calls `measureInWindow` and registers
`{x, y, width, height}` under `id`; unregisters on unmount. When no tour
is active it is a plain pass-through wrapper — zero measuring cost.

### `TourOverlay.tsx`

Rendered by `src/app/_layout.tsx` as an absolutely-positioned sibling
*after* `<Stack>` and inside `TourProvider`, which places it above both
the screens and the tab bar. Returns `null` when the tour is inactive.

- Dim layer: `react-native-svg` `<Rect>` covering the screen at ~72%
  `colors.bg`, with an evenodd rounded-rect cutout at the target rect,
  padded 8px, radius `radii.md`.
- Tooltip card: `colors.surfaceRaised` with `colors.border`, positioned
  above or below the cutout depending on which side has room; clamped to
  screen edges with a 16px margin. Contains title (`fonts.display`),
  body (`fonts.body`, `colors.inkDim`), a "3 of 12" counter, and the
  Back / Next / Skip row (`gold` primary for Next).
- Whole overlay swallows touches, so the underlying UI cannot be
  operated mid-tour. Advancing is via the buttons only — tapping the
  spotlight does nothing. Android hardware back maps to the tour's Back
  (and to Skip on the first step).
- Fades between steps with `react-native-reanimated` (already a dep);
  respects `AccessibilityInfo.isReduceMotionEnabled` by skipping the
  fade.
- Accessibility: card is an `accessibilityViewIsModal` region, focus
  moves to the title on each step change.

## Wiring / files touched

New:
- `src/onboarding/tourSteps.ts`
- `src/lib/tourMachine.ts`
- `src/onboarding/TourProvider.tsx`
- `src/onboarding/TourTarget.tsx`
- `src/onboarding/TourOverlay.tsx`

Edited:
- `src/app/_layout.tsx` — wrap in `TourProvider`, render `<TourOverlay/>`
  after `<Stack>`.
- `src/app/(tabs)/_layout.tsx` — register `tab.*` targets on the tab
  buttons.
- `src/app/(tabs)/index.tsx` — `TourTarget` wrappers for `home.total`,
  `home.buckets`, `home.recent`, `home.add`, `home.settings`
  (the gear at `index.tsx:44`, the FAB at `index.tsx:121`).
- `src/app/(tabs)/transactions.tsx` — `TourTarget` around the existing
  `notification-inbox-badge` pressable (`transactions.tsx:123`).
- `src/app/settings.tsx` — "Replay walkthrough" row: clears
  `onboardingCompleted` and calls `start()`.

Storage reuses the existing `app_settings` table via
`src/db/settingsRepo.ts`. One new key: `onboardingCompleted` (`'true'` /
absent). No schema migration, no change to `TABLES` in
`src/db/dataTransfer.ts` (that table is already covered).

## Testing

`logic` project (node):
- `src/lib/tourMachine.test.ts` — next/back/skip/finish, clamping
  at both ends, finish from the last step.

`ui` project, in `src/__tests__/` (never under `src/app/`, per repo
rules):
- `onboarding-overlay.test.tsx` — renders the first step, Next advances
  the copy, Back returns, Skip closes, counter text is correct.
- `onboarding-gate.test.tsx` — auto-starts when `onboardingCompleted` is
  absent, does not start when set, writes the flag on skip and on
  finish.
- `onboarding-fallback.test.tsx` — a step whose target never registers
  renders the centered-card layout instead of hanging.

Run from repo root with `--testPathIgnorePatterns=".claude"`; plain
`npx jest` inside a worktree.

## Risks

- `measureInWindow` returns stale rects if the underlying screen scrolls
  during a step. Mitigation: targets re-measure on layout, and the tour
  blocks touches so the user cannot scroll mid-step.
- Tab navigation mid-tour races with target registration. Mitigated by
  the 600ms timeout plus centered-card fallback — the tour degrades, it
  never stalls.
- Conditionally rendered elements hit the fallback path:
  `transactions.inbox` only renders when pending notifications exist,
  and `home.recent` is replaced by an empty-state line on a fresh
  install — which is exactly the state a first-run tour is in. Accepted:
  every step's copy has to read correctly with or without a spotlight,
  and the fallback centers the card.
