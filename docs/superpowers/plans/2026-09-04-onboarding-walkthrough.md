# Onboarding Walkthrough Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A coachmark-style guided tour that runs once on first launch — dimmed overlay, spotlight cutout on a real element, explanation card with Back / Next / Skip — replayable from Settings.

**Architecture:** A pure reducer in `src/lib/tourMachine.ts` owns step position. `TourProvider` (React context) holds that state plus a registry of measured target rects, drives tab navigation between steps, and reads/writes the `onboardingCompleted` key in the existing `app_settings` table. `TourTarget` wrappers measure real UI elements. `TourOverlay` renders above `<Stack>` in the root layout: an SVG dim layer with an evenodd cutout, plus the tooltip card.

**Tech Stack:** Expo SDK 57, expo-router, React Native, `react-native-svg` 15.15.4, drizzle + expo-sqlite, jest (two projects: `logic` node + ts-jest, `ui` jest-expo), `@testing-library/react-native`.

**Spec:** `docs/superpowers/specs/2026-09-04-onboarding-walkthrough-design.md`

## Global Constraints

- **Never** create `.test.ts`/`.test.tsx` files under `src/app/` — Metro bundles that directory as routes and the EAS build breaks. Screen tests live in `src/__tests__/`, importing screens via `@/app/<name>`.
- The `logic` jest project only picks up `src[\\/](lib|db)[\\/].*\.test\.ts$`. A `.test.ts` anywhere else runs in **no** project. `src/onboarding/` therefore holds no `.test.ts` files — only `.test.tsx` (matched by `ui`).
- Run tests from the repo root with `npx jest --testPathIgnorePatterns=".claude"`. Inside a worktree run plain `npx jest`.
- Dark theme only. All colors/fonts/spacing come from `@/theme` (`colors`, `fonts`, `spacing`, `radii`) — no literal hex in new code except the dim layer's opacity.
- `TourTarget` and any tour hook used inside a screen **must tolerate a missing provider**. Existing screen tests (e.g. `src/__tests__/add-transaction.test.tsx`) render screens with no `TourProvider` around them; throwing would break suites this feature does not own.
- Setting key: `onboardingCompleted`, value `'true'`. Read/write through `getSetting` / `setSetting` in `src/db/settingsRepo.ts`. No schema migration.
- No new dependencies. `react-native-svg` is already a dep and is already in the `ui` project's `transformIgnorePatterns`.
- Commit after every task, conventional-commit style, ending with the repo's `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` trailer.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/tourMachine.ts` (new) | Pure reducer: index, active, completed. No React. |
| `src/lib/tourMachine.test.ts` (new) | `logic` project tests for the reducer. |
| `src/onboarding/tourSteps.ts` (new) | `TourStep` / `Rect` / `TabRoute` types + the 12-step list. |
| `src/onboarding/TourProvider.tsx` (new) | Context: machine state, target registry, tab navigation, first-run gate, flag writes. Exports `TourProvider`, `useTour`, `useTourOptional`. |
| `src/onboarding/TourTarget.tsx` (new) | Measures and registers one target; pass-through when no tour is running. |
| `src/onboarding/TourOverlay.tsx` (new) | SVG dim + cutout, tooltip card, Back/Next/Skip, Android back handling. |
| `src/app/_layout.tsx` (modify) | Wrap in `TourProvider`, render `<TourOverlay />` after `<Stack>`. |
| `src/app/(tabs)/index.tsx` (modify) | `TourTarget` wrappers: `home.total`, `home.buckets`, `home.recent`, `home.add`, `home.settings`. |
| `src/app/(tabs)/transactions.tsx` (modify) | `TourTarget` around the inbox pill. |
| `src/app/settings.tsx` (modify) | "Replay walkthrough" action row. |
| `src/__tests__/onboarding-overlay.test.tsx` (new) | Overlay rendering + Next/Back/Skip. |
| `src/__tests__/onboarding-gate.test.tsx` (new) | First-run gate + flag writes. |
| `src/__tests__/onboarding-targets.test.tsx` (new) | Screens still render without a provider; targets register with one. |

---

### Task 1: Tour state machine

**Files:**
- Create: `src/lib/tourMachine.ts`
- Test: `src/lib/tourMachine.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type TourState = { active: boolean; index: number; completed: boolean }`, `type TourAction = { type: 'start' } | { type: 'next' } | { type: 'back' } | { type: 'skip' }`, `const INITIAL_TOUR_STATE: TourState`, `function tourReducer(state: TourState, action: TourAction, stepCount: number): TourState`, `function isLastStep(state: TourState, stepCount: number): boolean`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/tourMachine.test.ts`:

```ts
import { INITIAL_TOUR_STATE, isLastStep, tourReducer, TourState } from './tourMachine';

const COUNT = 3;
const at = (index: number): TourState => ({ active: true, index, completed: false });

describe('tourReducer', () => {
  it('starts at the first step', () => {
    expect(tourReducer(INITIAL_TOUR_STATE, { type: 'start' }, COUNT)).toEqual({
      active: true,
      index: 0,
      completed: false,
    });
  });

  it('restarts from the beginning even after completion', () => {
    const done = { active: false, index: 2, completed: true };
    expect(tourReducer(done, { type: 'start' }, COUNT)).toEqual({
      active: true,
      index: 0,
      completed: false,
    });
  });

  it('advances one step at a time', () => {
    expect(tourReducer(at(0), { type: 'next' }, COUNT)).toEqual(at(1));
  });

  it('finishes when next runs off the end', () => {
    expect(tourReducer(at(COUNT - 1), { type: 'next' }, COUNT)).toEqual({
      active: false,
      index: COUNT - 1,
      completed: true,
    });
  });

  it('goes back one step', () => {
    expect(tourReducer(at(2), { type: 'back' }, COUNT)).toEqual(at(1));
  });

  it('ignores back on the first step', () => {
    expect(tourReducer(at(0), { type: 'back' }, COUNT)).toEqual(at(0));
  });

  it('skip completes from anywhere', () => {
    expect(tourReducer(at(1), { type: 'skip' }, COUNT)).toEqual({
      active: false,
      index: 1,
      completed: true,
    });
  });

  it('ignores next and back while inactive', () => {
    expect(tourReducer(INITIAL_TOUR_STATE, { type: 'next' }, COUNT)).toEqual(INITIAL_TOUR_STATE);
    expect(tourReducer(INITIAL_TOUR_STATE, { type: 'back' }, COUNT)).toEqual(INITIAL_TOUR_STATE);
  });

  // A zero-length step list is not a real configuration, but `start` must not
  // leave the tour active pointing at a step that cannot be rendered.
  it('cannot start an empty tour', () => {
    expect(tourReducer(INITIAL_TOUR_STATE, { type: 'start' }, 0)).toEqual({
      active: false,
      index: 0,
      completed: true,
    });
  });
});

describe('isLastStep', () => {
  it('is true only on the final index', () => {
    expect(isLastStep(at(1), COUNT)).toBe(false);
    expect(isLastStep(at(2), COUNT)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathIgnorePatterns=".claude" src/lib/tourMachine.test.ts`
Expected: FAIL — `Cannot find module './tourMachine'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/tourMachine.ts`:

```ts
/**
 * Position state for the first-run walkthrough. Pure — no React, no React
 * Native — so it runs in the node-environment `logic` jest project, which is
 * also why it lives here rather than in `src/onboarding/` (that directory is
 * outside the project's testRegex).
 */
export type TourState = {
  /** Overlay is on screen. */
  active: boolean;
  /** Index into the step list. Kept when the tour ends so nothing flickers. */
  index: number;
  /** The user reached the end or skipped; the persisted flag mirrors this. */
  completed: boolean;
};

export type TourAction =
  | { type: 'start' }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'skip' };

export const INITIAL_TOUR_STATE: TourState = { active: false, index: 0, completed: false };

export function isLastStep(state: TourState, stepCount: number): boolean {
  return state.index >= stepCount - 1;
}

export function tourReducer(state: TourState, action: TourAction, stepCount: number): TourState {
  switch (action.type) {
    case 'start':
      // Replay has to clear `completed` too, or the overlay would open already
      // marked done and the Settings row would look like it did nothing.
      if (stepCount === 0) return { active: false, index: 0, completed: true };
      return { active: true, index: 0, completed: false };
    case 'next':
      if (!state.active) return state;
      if (isLastStep(state, stepCount)) return { ...state, active: false, completed: true };
      return { ...state, index: state.index + 1 };
    case 'back':
      if (!state.active || state.index === 0) return state;
      return { ...state, index: state.index - 1 };
    case 'skip':
      if (!state.active) return state;
      return { ...state, active: false, completed: true };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --testPathIgnorePatterns=".claude" src/lib/tourMachine.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tourMachine.ts src/lib/tourMachine.test.ts
git commit -m "feat: add the onboarding tour state machine"
```

---

### Task 2: Step list and types

**Files:**
- Create: `src/onboarding/tourSteps.ts`
- Test: none of its own (it is data; Tasks 4–6 assert on its copy).

**Interfaces:**
- Consumes: nothing.
- Produces: `type TabRoute`, `type Rect = { x: number; y: number; width: number; height: number }`, `type TourStep = { id: string; tab: TabRoute; targetId?: string; title: string; body: string }`, `const TOUR_STEPS: readonly TourStep[]` (12 entries), `const ONBOARDING_COMPLETED_KEY = 'onboardingCompleted'`.

- [ ] **Step 1: Write the file**

Create `src/onboarding/tourSteps.ts`:

```ts
/**
 * The walkthrough as data. Every step names the tab it belongs to; the
 * provider navigates there before showing it. `targetId` is optional — a step
 * without one (and any step whose target never registers) renders as a
 * centered card.
 */

export type TabRoute =
  | '/(tabs)'
  | '/(tabs)/transactions'
  | '/(tabs)/recurring'
  | '/(tabs)/utang'
  | '/(tabs)/stats';

/** A measured target, in window coordinates. */
export type Rect = { x: number; y: number; width: number; height: number };

export type TourStep = {
  /** Stable id; also the overlay card's testID suffix. */
  id: string;
  tab: TabRoute;
  targetId?: string;
  title: string;
  body: string;
};

export const ONBOARDING_COMPLETED_KEY = 'onboardingCompleted';

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'welcome',
    tab: '/(tabs)',
    title: 'Welcome to Kuripot',
    body: 'A quick tour of the five tabs and what each one is for. About 30 seconds — you can skip any time.',
  },
  {
    id: 'total',
    tab: '/(tabs)',
    targetId: 'home.total',
    title: 'Your total money',
    body: 'Every bucket added up. This is what you actually have, across cash, banks and e-wallets.',
  },
  {
    id: 'buckets',
    tab: '/(tabs)',
    targetId: 'home.buckets',
    title: 'Buckets hold your money',
    body: 'A bucket is one place money sits — Cash, GCash, a bank, a credit card. Tap one to see only its transactions.',
  },
  {
    id: 'recent',
    tab: '/(tabs)',
    targetId: 'home.recent',
    title: 'Recent activity',
    body: 'Your last ten transactions. Tap any row to edit or delete it.',
  },
  {
    id: 'add',
    tab: '/(tabs)',
    targetId: 'home.add',
    title: 'Log an expense',
    body: 'The + button records an expense, income, or a transfer between two buckets.',
  },
  {
    id: 'settings',
    tab: '/(tabs)',
    targetId: 'home.settings',
    title: 'Settings and backups',
    body: 'The gear holds category management, JSON backup and restore, and auto-logging from bank notifications.',
  },
  {
    id: 'transactions',
    tab: '/(tabs)/transactions',
    targetId: 'tab.transactions',
    title: 'Transactions',
    body: 'Your whole history, filtered by month, type, bucket or category.',
  },
  {
    id: 'inbox',
    tab: '/(tabs)/transactions',
    targetId: 'transactions.inbox',
    title: 'Notification inbox',
    body: 'When auto-log catches a bank notification it waits here, so nothing is recorded without you confirming it.',
  },
  {
    id: 'recurring',
    tab: '/(tabs)/recurring',
    targetId: 'tab.recurring',
    title: 'Recurring and installments',
    body: 'Bills that repeat, and purchases you pay off monthly. Kuripot posts them for you on their due dates.',
  },
  {
    id: 'utang',
    tab: '/(tabs)/utang',
    targetId: 'tab.utang',
    title: 'Utang',
    body: 'Money you owe and money owed to you, with partial payments tracked against each debt.',
  },
  {
    id: 'stats',
    tab: '/(tabs)/stats',
    targetId: 'tab.stats',
    title: 'Stats',
    body: 'Six-month trends, spending by category, and what your monthly commitments add up to.',
  },
  {
    id: 'done',
    tab: '/(tabs)',
    title: "That's the tour",
    body: 'Start by adding a bucket for your cash, then log your first expense. Replay this any time from Settings.',
  },
];
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/onboarding/tourSteps.ts
git commit -m "feat: add the onboarding tour step list"
```

---

### Task 3: Provider and target registry

**Files:**
- Create: `src/onboarding/TourProvider.tsx`, `src/onboarding/TourTarget.tsx`
- Test: `src/__tests__/onboarding-gate.test.tsx`

**Interfaces:**
- Consumes: `tourReducer`, `INITIAL_TOUR_STATE`, `isLastStep`, `TourState` from `@/lib/tourMachine`; `TOUR_STEPS`, `ONBOARDING_COMPLETED_KEY`, `TourStep`, `Rect` from `./tourSteps`; `useDb` from `@/db/DbProvider`; `getSetting`, `setSetting` from `@/db/settingsRepo`.
- Produces:
  - `<TourProvider steps?: readonly TourStep[]>` — `steps` defaults to `TOUR_STEPS`; tests pass a short list.
  - `type TourContextValue = { active: boolean; step: TourStep | null; index: number; stepCount: number; rect: Rect | null; resolving: boolean; next(): void; back(): void; skip(): void; start(): void; registerTarget(id: string, rect: Rect): void; unregisterTarget(id: string): void }`
  - `function useTour(): TourContextValue` — throws outside a provider.
  - `function useTourOptional(): TourContextValue | null` — returns `null` outside a provider.
  - `const TARGET_TIMEOUT_MS = 600`
  - `<TourTarget id: string, children: ReactNode, style?: StyleProp<ViewStyle>>`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/onboarding-gate.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { createTestDb, TestDb } from '@/db/testDb';
import { getSetting, setSetting } from '@/db/settingsRepo';
import { TourProvider, useTour } from '@/onboarding/TourProvider';
import { ONBOARDING_COMPLETED_KEY, TourStep } from '@/onboarding/tourSteps';

const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: mockNavigate, push: jest.fn(), back: jest.fn() }),
  usePathname: () => '/(tabs)',
}));

let mockTestDb: TestDb;
jest.mock('@/db/DbProvider', () => ({
  useDb: () => ({ db: mockTestDb, version: 0, refresh: jest.fn(), catchUp: null }),
}));

const STEPS: TourStep[] = [
  { id: 'one', tab: '/(tabs)', title: 'One', body: 'First step.' },
  { id: 'two', tab: '/(tabs)', title: 'Two', body: 'Second step.' },
];

/** Minimal consumer: shows the current step and exposes the controls. */
function Probe() {
  const tour = useTour();
  return (
    <>
      <Text testID="state">{tour.active ? (tour.step?.id ?? 'none') : 'inactive'}</Text>
      <Text testID="next" onPress={tour.next}>
        next
      </Text>
      <Text testID="skip" onPress={tour.skip}>
        skip
      </Text>
      <Text testID="start" onPress={tour.start}>
        start
      </Text>
    </>
  );
}

beforeEach(() => {
  mockTestDb = createTestDb();
  mockNavigate.mockClear();
});

describe('onboarding first-run gate', () => {
  it('starts itself when the completed flag is absent', async () => {
    render(
      <TourProvider steps={STEPS}>
        <Probe />
      </TourProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('one'));
  });

  it('stays closed when the flag is already set', async () => {
    await setSetting(mockTestDb, ONBOARDING_COMPLETED_KEY, 'true');

    render(
      <TourProvider steps={STEPS}>
        <Probe />
      </TourProvider>,
    );

    // Give the gate's read a chance to resolve before asserting the negative.
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('inactive'));
    expect(screen.getByTestId('state')).toHaveTextContent('inactive');
  });

  it('writes the flag when the last step is finished', async () => {
    render(
      <TourProvider steps={STEPS}>
        <Probe />
      </TourProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('one'));
    fireEvent.press(screen.getByTestId('next'));
    fireEvent.press(screen.getByTestId('next'));

    await waitFor(async () =>
      expect(await getSetting(mockTestDb, ONBOARDING_COMPLETED_KEY)).toBe('true'),
    );
    expect(screen.getByTestId('state')).toHaveTextContent('inactive');
  });

  it('writes the flag when skipped', async () => {
    render(
      <TourProvider steps={STEPS}>
        <Probe />
      </TourProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('one'));
    fireEvent.press(screen.getByTestId('skip'));

    await waitFor(async () =>
      expect(await getSetting(mockTestDb, ONBOARDING_COMPLETED_KEY)).toBe('true'),
    );
  });

  it('replays on demand after completion', async () => {
    await setSetting(mockTestDb, ONBOARDING_COMPLETED_KEY, 'true');

    render(
      <TourProvider steps={STEPS}>
        <Probe />
      </TourProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('inactive'));
    fireEvent.press(screen.getByTestId('start'));

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('one'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathIgnorePatterns=".claude" src/__tests__/onboarding-gate.test.tsx`
Expected: FAIL — `Cannot find module '@/onboarding/TourProvider'`.

- [ ] **Step 3: Write the provider**

Create `src/onboarding/TourProvider.tsx`:

```tsx
import { useRouter, usePathname } from 'expo-router';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useDb } from '@/db/DbProvider';
import { getSetting, setSetting } from '@/db/settingsRepo';
import { INITIAL_TOUR_STATE, isLastStep, TourAction, tourReducer } from '@/lib/tourMachine';
import { ONBOARDING_COMPLETED_KEY, Rect, TOUR_STEPS, TourStep } from './tourSteps';

/**
 * How long a step waits for its target to measure itself before giving up and
 * rendering as a centered card. A tab switch plus a layout pass lands well
 * inside this; a conditionally-rendered target (the inbox pill with an empty
 * inbox) never lands at all, and must not stall the tour.
 */
export const TARGET_TIMEOUT_MS = 600;

export type TourContextValue = {
  active: boolean;
  step: TourStep | null;
  index: number;
  stepCount: number;
  /** Measured target for the current step, or null to render centered. */
  rect: Rect | null;
  /** Still waiting on the current step's target; the overlay dims but holds. */
  resolving: boolean;
  next: () => void;
  back: () => void;
  skip: () => void;
  start: () => void;
  registerTarget: (id: string, rect: Rect) => void;
  unregisterTarget: (id: string) => void;
};

const TourContext = createContext<TourContextValue | null>(null);

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour must be used inside TourProvider');
  return ctx;
}

/**
 * Screens are rendered bare by their own tests, and modal routes mount outside
 * anything the root layout wraps. Anything a screen calls has to survive a
 * missing provider, so target-side code uses this and not `useTour`.
 */
export function useTourOptional(): TourContextValue | null {
  return useContext(TourContext);
}

export function TourProvider({
  children,
  steps = TOUR_STEPS,
}: {
  children: React.ReactNode;
  steps?: readonly TourStep[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { db } = useDb();

  const [state, rawDispatch] = useReducer(
    (prev: typeof INITIAL_TOUR_STATE, action: TourAction) => tourReducer(prev, action, steps.length),
    INITIAL_TOUR_STATE,
  );

  const [rects, setRects] = useState<Record<string, Rect>>({});
  const [timedOut, setTimedOut] = useState(false);

  const step = state.active ? (steps[state.index] ?? null) : null;

  // ---- first-run gate ------------------------------------------------------
  // Runs once per mount. `db` is stable for the life of the provider, and the
  // ref keeps a re-render (or a StrictMode double-effect) from re-opening a
  // tour the user just skipped.
  const gateChecked = useRef(false);
  useEffect(() => {
    if (gateChecked.current) return;
    gateChecked.current = true;
    let cancelled = false;
    (async () => {
      try {
        const done = await getSetting(db, ONBOARDING_COMPLETED_KEY);
        if (!cancelled && done === null) rawDispatch({ type: 'start' });
      } catch {
        // A settings read that fails is not worth blocking the app for: the
        // user simply does not get the tour on this launch.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db]);

  const markCompleted = useCallback(() => {
    setSetting(db, ONBOARDING_COMPLETED_KEY, 'true').catch(() => {});
  }, [db]);

  // ---- controls ------------------------------------------------------------
  const next = useCallback(() => {
    if (isLastStep(state, steps.length)) markCompleted();
    rawDispatch({ type: 'next' });
  }, [markCompleted, state, steps.length]);

  const back = useCallback(() => rawDispatch({ type: 'back' }), []);

  const skip = useCallback(() => {
    markCompleted();
    rawDispatch({ type: 'skip' });
  }, [markCompleted]);

  const start = useCallback(() => rawDispatch({ type: 'start' }), []);

  // ---- target registry -----------------------------------------------------
  const registerTarget = useCallback((id: string, rect: Rect) => {
    setRects((prev) => {
      const old = prev[id];
      if (
        old &&
        old.x === rect.x &&
        old.y === rect.y &&
        old.width === rect.width &&
        old.height === rect.height
      ) {
        return prev; // identical measurement — do not churn the tree
      }
      return { ...prev, [id]: rect };
    });
  }, []);

  const unregisterTarget = useCallback((id: string) => {
    setRects((prev) => {
      if (!(id in prev)) return prev;
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  }, []);

  // ---- navigation ----------------------------------------------------------
  // Each step declares its tab; move there before it is shown. Comparing
  // against `pathname` keeps this from re-navigating on every render.
  useEffect(() => {
    if (!step) return;
    if (pathname !== step.tab) router.navigate(step.tab);
  }, [pathname, router, step]);

  // ---- target resolution timeout ------------------------------------------
  useEffect(() => {
    setTimedOut(false);
    if (!step?.targetId) return;
    const timer = setTimeout(() => setTimedOut(true), TARGET_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [step]);

  const rect = step?.targetId ? (rects[step.targetId] ?? null) : null;
  const resolving = Boolean(step?.targetId) && rect === null && !timedOut;

  const value = useMemo<TourContextValue>(
    () => ({
      active: state.active,
      step,
      index: state.index,
      stepCount: steps.length,
      rect,
      resolving,
      next,
      back,
      skip,
      start,
      registerTarget,
      unregisterTarget,
    }),
    [
      back,
      next,
      rect,
      registerTarget,
      resolving,
      skip,
      start,
      state.active,
      state.index,
      step,
      steps.length,
      unregisterTarget,
    ],
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}
```

- [ ] **Step 4: Write the target wrapper**

Create `src/onboarding/TourTarget.tsx`:

```tsx
import React, { useCallback, useRef } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { useTourOptional } from './TourProvider';

/**
 * Wraps a real UI element so the overlay can spotlight it.
 *
 * Measuring is deliberately lazy: with no provider (every screen test, and any
 * modal route mounted outside the root layout's tree) or with no tour running,
 * this is a plain `View` and `measureInWindow` is never called.
 */
export function TourTarget({
  id,
  children,
  style,
}: {
  id: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const tour = useTourOptional();
  const ref = useRef<View>(null);
  const active = tour?.active ?? false;
  const register = tour?.registerTarget;
  const unregister = tour?.unregisterTarget;

  const onLayout = useCallback(() => {
    if (!active || !register) return;
    // `measureInWindow` is what the overlay needs: the overlay is a sibling of
    // the whole navigator, so target coordinates have to be window-absolute,
    // not relative to whatever scroll container the target happens to sit in.
    ref.current?.measureInWindow((x, y, width, height) => {
      if (width === 0 && height === 0) return;
      register(id, { x, y, width, height });
    });
  }, [active, id, register]);

  React.useEffect(() => {
    if (!active) return;
    return () => unregister?.(id);
  }, [active, id, unregister]);

  // Re-measure when a tour starts on an element that was already laid out.
  React.useEffect(() => {
    if (active) onLayout();
  }, [active, onLayout]);

  return (
    <View ref={ref} style={style} onLayout={onLayout} collapsable={false}>
      {children}
    </View>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest --testPathIgnorePatterns=".claude" src/__tests__/onboarding-gate.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/onboarding/TourProvider.tsx src/onboarding/TourTarget.tsx src/__tests__/onboarding-gate.test.tsx
git commit -m "feat: add the onboarding tour provider and target registry"
```

---

### Task 4: Overlay

**Files:**
- Create: `src/onboarding/TourOverlay.tsx`
- Test: `src/__tests__/onboarding-overlay.test.tsx`

**Interfaces:**
- Consumes: `useTourOptional` from `./TourProvider`; `colors`, `fonts`, `radii`, `spacing` from `@/theme`.
- Produces: `function TourOverlay(): JSX.Element | null`. TestIDs it renders: `tour-overlay`, `tour-title`, `tour-body`, `tour-counter`, `tour-next`, `tour-back`, `tour-skip`, `tour-spotlight` (only when a rect resolved).

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/onboarding-overlay.test.tsx`:

```tsx
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { createTestDb, TestDb } from '@/db/testDb';
import { TourOverlay } from '@/onboarding/TourOverlay';
import { TourProvider } from '@/onboarding/TourProvider';
import { TourStep } from '@/onboarding/tourSteps';

jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: jest.fn(), push: jest.fn(), back: jest.fn() }),
  usePathname: () => '/(tabs)',
}));

let mockTestDb: TestDb;
jest.mock('@/db/DbProvider', () => ({
  useDb: () => ({ db: mockTestDb, version: 0, refresh: jest.fn(), catchUp: null }),
}));

const STEPS: TourStep[] = [
  { id: 'one', tab: '/(tabs)', title: 'First thing', body: 'Body one.' },
  { id: 'two', tab: '/(tabs)', title: 'Second thing', body: 'Body two.' },
  { id: 'three', tab: '/(tabs)', title: 'Third thing', body: 'Body three.' },
];

function renderOverlay() {
  return render(
    <TourProvider steps={STEPS}>
      <TourOverlay />
    </TourProvider>,
  );
}

beforeEach(() => {
  mockTestDb = createTestDb();
});

describe('tour overlay', () => {
  it('shows the first step with a step counter', async () => {
    renderOverlay();

    await waitFor(() => expect(screen.getByTestId('tour-title')).toHaveTextContent('First thing'));
    expect(screen.getByTestId('tour-body')).toHaveTextContent('Body one.');
    expect(screen.getByTestId('tour-counter')).toHaveTextContent('1 of 3');
  });

  it('advances and returns', async () => {
    renderOverlay();

    await waitFor(() => expect(screen.getByTestId('tour-title')).toHaveTextContent('First thing'));
    fireEvent.press(screen.getByTestId('tour-next'));
    await waitFor(() => expect(screen.getByTestId('tour-title')).toHaveTextContent('Second thing'));
    expect(screen.getByTestId('tour-counter')).toHaveTextContent('2 of 3');

    fireEvent.press(screen.getByTestId('tour-back'));
    await waitFor(() => expect(screen.getByTestId('tour-title')).toHaveTextContent('First thing'));
  });

  it('hides Back on the first step and labels the last Next as Done', async () => {
    renderOverlay();

    await waitFor(() => expect(screen.getByTestId('tour-title')).toHaveTextContent('First thing'));
    expect(screen.queryByTestId('tour-back')).toBeNull();

    fireEvent.press(screen.getByTestId('tour-next'));
    fireEvent.press(screen.getByTestId('tour-next'));
    await waitFor(() => expect(screen.getByTestId('tour-title')).toHaveTextContent('Third thing'));
    expect(screen.getByTestId('tour-next')).toHaveTextContent('Done');
  });

  it('closes on skip', async () => {
    renderOverlay();

    await waitFor(() => expect(screen.getByTestId('tour-overlay')).toBeTruthy());
    fireEvent.press(screen.getByTestId('tour-skip'));

    await waitFor(() => expect(screen.queryByTestId('tour-overlay')).toBeNull());
  });

  it('closes after the last step', async () => {
    renderOverlay();

    await waitFor(() => expect(screen.getByTestId('tour-overlay')).toBeTruthy());
    fireEvent.press(screen.getByTestId('tour-next'));
    fireEvent.press(screen.getByTestId('tour-next'));
    fireEvent.press(screen.getByTestId('tour-next'));

    await waitFor(() => expect(screen.queryByTestId('tour-overlay')).toBeNull());
  });

  it('renders nothing without a provider', () => {
    render(<TourOverlay />);
    expect(screen.queryByTestId('tour-overlay')).toBeNull();
  });

  it('falls back to a centered card when the target never measures', async () => {
    jest.useFakeTimers();
    try {
      render(
        <TourProvider steps={[{ ...STEPS[0], targetId: 'nobody.registers.this' }]}>
          <TourOverlay />
        </TourProvider>,
      );

      // Before the timeout there is a dim layer but no spotlight and no card.
      await waitFor(() => expect(screen.getByTestId('tour-overlay')).toBeTruthy());
      expect(screen.queryByTestId('tour-title')).toBeNull();

      act(() => {
        jest.advanceTimersByTime(700);
      });

      await waitFor(() => expect(screen.getByTestId('tour-title')).toHaveTextContent('First thing'));
      expect(screen.queryByTestId('tour-spotlight')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathIgnorePatterns=".claude" src/__tests__/onboarding-overlay.test.tsx`
Expected: FAIL — `Cannot find module '@/onboarding/TourOverlay'`.

- [ ] **Step 3: Write the overlay**

Create `src/onboarding/TourOverlay.tsx`:

```tsx
import React, { useEffect } from 'react';
import { BackHandler, Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors, fonts, radii, spacing } from '@/theme';
import { useTourOptional } from './TourProvider';
import { Rect } from './tourSteps';

/** Breathing room between the spotlight edge and the element it reveals. */
const SPOTLIGHT_PAD = 8;
/** Gap between the spotlight and the tooltip card. */
const CARD_GAP = 12;
const CARD_MARGIN = 16;
const CARD_ESTIMATED_HEIGHT = 190;

/**
 * A full-screen path with a rounded-rect hole punched in it. `evenodd` is what
 * makes the inner subpath a hole rather than a second filled shape.
 */
function maskPath(width: number, height: number, hole: Rect, radius: number): string {
  const x = hole.x - SPOTLIGHT_PAD;
  const y = hole.y - SPOTLIGHT_PAD;
  const w = hole.width + SPOTLIGHT_PAD * 2;
  const h = hole.height + SPOTLIGHT_PAD * 2;
  const r = Math.min(radius, w / 2, h / 2);
  return [
    `M0 0H${width}V${height}H0Z`,
    `M${x + r} ${y}`,
    `H${x + w - r}`,
    `A${r} ${r} 0 0 1 ${x + w} ${y + r}`,
    `V${y + h - r}`,
    `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}`,
    `H${x + r}`,
    `A${r} ${r} 0 0 1 ${x} ${y + h - r}`,
    `V${y + r}`,
    `A${r} ${r} 0 0 1 ${x + r} ${y}`,
    'Z',
  ].join(' ');
}

/**
 * The first-run walkthrough overlay. Rendered by the root layout as a sibling
 * of the navigator so it covers the tab bar as well as the screen, and returns
 * null whenever no tour is running — including when there is no provider at
 * all, which is how every screen test sees it.
 */
export function TourOverlay() {
  const tour = useTourOptional();
  const { width, height } = Dimensions.get('window');

  const active = tour?.active ?? false;
  const back = tour?.back;
  const skip = tour?.skip;
  const index = tour?.index ?? 0;

  // Android's hardware back belongs to the tour while it is up: backing out of
  // the app mid-tour would leave the flag unwritten and re-run it next launch.
  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (index === 0) skip?.();
      else back?.();
      return true;
    });
    return () => sub.remove();
  }, [active, back, index, skip]);

  if (!tour || !tour.active || !tour.step) return null;

  const { step, rect, resolving, stepCount } = tour;
  const spotlight = rect;

  // Below the spotlight if there is room, otherwise above it.
  let cardTop = height / 2 - CARD_ESTIMATED_HEIGHT / 2;
  if (spotlight) {
    const below = spotlight.y + spotlight.height + SPOTLIGHT_PAD + CARD_GAP;
    const above = spotlight.y - SPOTLIGHT_PAD - CARD_GAP - CARD_ESTIMATED_HEIGHT;
    cardTop = below + CARD_ESTIMATED_HEIGHT + CARD_MARGIN <= height ? below : Math.max(CARD_MARGIN, above);
  }

  return (
    <View style={styles.fill} testID="tour-overlay" pointerEvents="box-none">
      {/* Swallows every touch aimed at the app underneath: the tour advances
          through its own buttons only, so nothing can be tapped out of order. */}
      <Pressable style={styles.fill} onPress={() => {}} accessible={false} />

      <Svg style={styles.fill} width={width} height={height} pointerEvents="none">
        <Path
          testID={spotlight ? 'tour-spotlight' : 'tour-dim'}
          d={spotlight ? maskPath(width, height, spotlight, radii.md) : `M0 0H${width}V${height}H0Z`}
          fill={colors.bg}
          fillOpacity={0.82}
          fillRule="evenodd"
        />
      </Svg>

      {/* While a target is still measuring, the screen dims but no card shows —
          otherwise the card would jump as soon as the rect landed. */}
      {!resolving && (
        <View style={[styles.card, { top: cardTop }]} accessibilityViewIsModal>
          <Text style={styles.title} testID="tour-title" accessibilityRole="header">
            {step.title}
          </Text>
          <Text style={styles.body} testID="tour-body">
            {step.body}
          </Text>
          <Text style={styles.counter} testID="tour-counter">
            {index + 1} of {stepCount}
          </Text>
          <View style={styles.actions}>
            <Pressable onPress={tour.skip} hitSlop={8} accessibilityRole="button" testID="tour-skip">
              <Text style={styles.skip}>Skip</Text>
            </Pressable>
            <View style={styles.actionsRight}>
              {index > 0 && (
                <Pressable onPress={tour.back} hitSlop={8} accessibilityRole="button" testID="tour-back">
                  <Text style={styles.back}>Back</Text>
                </Pressable>
              )}
              <Pressable
                style={styles.nextButton}
                onPress={tour.next}
                accessibilityRole="button"
                testID="tour-next"
              >
                <Text style={styles.nextText}>{index === stepCount - 1 ? 'Done' : 'Next'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject },
  card: {
    position: 'absolute',
    left: CARD_MARGIN,
    right: CARD_MARGIN,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: { fontFamily: fonts.display, fontSize: 19, color: colors.ink },
  body: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.inkDim },
  counter: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.inkFaint,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  actionsRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  skip: { fontFamily: fonts.body, fontSize: 14, color: colors.inkFaint },
  back: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.inkDim },
  nextButton: {
    backgroundColor: colors.gold,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  nextText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.bg },
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest --testPathIgnorePatterns=".claude" src/__tests__/onboarding-overlay.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/onboarding/TourOverlay.tsx src/__tests__/onboarding-overlay.test.tsx
git commit -m "feat: add the onboarding tour overlay"
```

---

### Task 5: Mount the tour in the root layout

**Files:**
- Modify: `src/app/_layout.tsx:33-66`

**Interfaces:**
- Consumes: `TourProvider` from `@/onboarding/TourProvider`, `TourOverlay` from `@/onboarding/TourOverlay`.
- Produces: nothing new. The provider must sit **inside** `DbProvider` (it calls `useDb`) and the overlay must be the **last** child so it paints over both `<Stack>` and the tab bar.

- [ ] **Step 1: Edit the layout**

In `src/app/_layout.tsx`, add the imports:

```tsx
import { TourOverlay } from '@/onboarding/TourOverlay';
import { TourProvider } from '@/onboarding/TourProvider';
```

Then wrap the body — keep every existing `<Stack.Screen>` line exactly as it is:

```tsx
    <ErrorBoundary>
      <DbProvider>
        <TourProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            {/* ...every existing Stack.Screen, unchanged... */}
          </Stack>
          {/* Last child, so it covers the navigator and the tab bar both. */}
          <TourOverlay />
        </TourProvider>
      </DbProvider>
    </ErrorBoundary>
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the whole suite — nothing else may regress**

Run: `npx jest --testPathIgnorePatterns=".claude"`
Expected: PASS, both projects.

- [ ] **Step 4: Commit**

```bash
git add src/app/_layout.tsx
git commit -m "feat: mount the onboarding tour above the navigator"
```

---

### Task 6: Wire targets and the Settings replay row

**Files:**
- Modify: `src/app/(tabs)/index.tsx` (hero, buckets FlatList, Recent block, FAB, settings gear)
- Modify: `src/app/(tabs)/transactions.tsx:121-129` (inbox pill)
- Modify: `src/app/settings.tsx` (replay row, near the "Organize" section)
- Test: `src/__tests__/onboarding-targets.test.tsx`

**Interfaces:**
- Consumes: `TourTarget` from `@/onboarding/TourTarget`, `useTourOptional` from `@/onboarding/TourProvider`, `setSetting` from `@/db/settingsRepo`, `ONBOARDING_COMPLETED_KEY` from `@/onboarding/tourSteps`.
- Produces: registered target ids `home.total`, `home.buckets`, `home.recent`, `home.add`, `home.settings`, `transactions.inbox`. Settings row testID `replay-walkthrough`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/onboarding-targets.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { buckets } from '@/db/schema';
import { getSetting, setSetting } from '@/db/settingsRepo';
import { createTestDb, TestDb } from '@/db/testDb';
import { ONBOARDING_COMPLETED_KEY } from '@/onboarding/tourSteps';
import HomeScreen from '@/app/(tabs)/index';
import SettingsScreen from '@/app/settings';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), navigate: jest.fn() }),
  usePathname: () => '/(tabs)',
  useLocalSearchParams: () => ({}),
}));

let mockTestDb: TestDb;
jest.mock('@/db/DbProvider', () => ({
  useDb: () => ({ db: mockTestDb, version: 0, refresh: jest.fn(), catchUp: null }),
}));

beforeEach(() => {
  mockTestDb = createTestDb();
  mockPush.mockClear();
});

describe('tour targets on real screens', () => {
  // The guard that matters: every screen test in this repo renders bare, with
  // no TourProvider anywhere above it. TourTarget has to be inert there.
  it('home still renders with no provider in the tree', async () => {
    await mockTestDb.insert(buckets).values({ name: 'Cash' });

    await render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('Total money')).toBeTruthy());
    expect(screen.getByLabelText('Add transaction')).toBeTruthy();
  });
});

describe('settings replay row', () => {
  it('clears the completed flag so the tour runs again', async () => {
    await setSetting(mockTestDb, ONBOARDING_COMPLETED_KEY, 'true');

    await render(<SettingsScreen />);

    await waitFor(() => expect(screen.getByTestId('replay-walkthrough')).toBeTruthy());
    fireEvent.press(screen.getByTestId('replay-walkthrough'));

    await waitFor(async () =>
      expect(await getSetting(mockTestDb, ONBOARDING_COMPLETED_KEY)).toBeNull(),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathIgnorePatterns=".claude" src/__tests__/onboarding-targets.test.tsx`
Expected: FAIL — `Unable to find an element with testID: replay-walkthrough`. (The first test may already pass; that is fine — it is a regression guard.)

- [ ] **Step 3: Add a clear helper to the settings repo**

Add to `src/db/settingsRepo.ts`:

```ts
export async function clearSetting(db: Db, key: string): Promise<void> {
  await db.delete(appSettings).where(eq(appSettings.key, key));
}
```

- [ ] **Step 4: Wrap the home-screen targets**

In `src/app/(tabs)/index.tsx`, import `import { TourTarget } from '@/onboarding/TourTarget';` and wrap five elements. The gear:

```tsx
          <TourTarget id="home.settings">
            <Pressable
              onPress={() => router.push('/settings')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Settings"
            >
              <Text style={styles.settingsLink}>⚙</Text>
            </Pressable>
          </TourTarget>
```

The hero — put the wrapper outside, and leave `styles.hero` on the inner `View` so the card keeps its own margin:

```tsx
        <TourTarget id="home.total">
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>Total money</Text>
            <Text style={styles.heroAmount}>{total === undefined ? '…' : formatPeso(total)}</Text>
          </View>
        </TourTarget>
```

The buckets carousel — wrap the `<FlatList horizontal ...>` alone (not the section header):

```tsx
        <TourTarget id="home.buckets">
          <FlatList
            horizontal
            {/* ...unchanged props... */}
          />
        </TourTarget>
```

The Recent block — wrap the `Recent` title together with the rows so the spotlight covers the list even when it is the empty-state line:

```tsx
        <TourTarget id="home.recent">
          <Text style={styles.sectionTitle}>Recent</Text>
          {/* ...the error notice, spinner, empty line and the mapped rows, unchanged... */}
        </TourTarget>
```

The FAB — the wrapper takes the absolute positioning, the `Pressable` keeps the shape:

```tsx
      <TourTarget id="home.add" style={styles.fabAnchor}>
        <Pressable
          style={styles.fab}
          onPress={() => router.push('/add-transaction')}
          accessibilityRole="button"
          accessibilityLabel="Add transaction"
        >
          {/* ...unchanged glyph and its comment... */}
        </Pressable>
      </TourTarget>
```

and split the FAB style in two:

```ts
  fabAnchor: { position: 'absolute', right: spacing.lg, bottom: spacing.lg },
  fab: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
  },
```

- [ ] **Step 5: Wrap the inbox pill**

In `src/app/(tabs)/transactions.tsx`, import `TourTarget` and wrap the existing pill, keeping the `inboxCount > 0` guard outside:

```tsx
      {inboxCount > 0 && (
        <TourTarget id="transactions.inbox">
          <Pressable
            style={styles.inboxPill}
            onPress={() => router.push('/notification-inbox')}
            accessibilityRole="button"
            testID="notification-inbox-badge"
          >
            <Text style={styles.inboxPillText}>Inbox {inboxCount}</Text>
          </Pressable>
        </TourTarget>
      )}
```

- [ ] **Step 6: Add the Settings replay row**

In `src/app/settings.tsx`, add imports:

```tsx
import { clearSetting } from '@/db/settingsRepo';
import { useTourOptional } from '@/onboarding/TourProvider';
import { ONBOARDING_COMPLETED_KEY } from '@/onboarding/tourSteps';
```

Inside the component, next to the existing `useDb()` usage:

```tsx
  const tour = useTourOptional();

  // Clearing the flag is what actually makes the tour run again; `start()` is
  // the immediate effect. The screen's own tests render it with no provider,
  // hence the optional hook and the optional call.
  const replayWalkthrough = async () => {
    await clearSetting(db, ONBOARDING_COMPLETED_KEY);
    router.back();
    tour?.start();
  };
```

and render the row just above the `Organize` section title:

```tsx
        <Text style={styles.sectionTitle}>Help</Text>
        <Pressable
          style={styles.action}
          onPress={replayWalkthrough}
          accessibilityRole="button"
          testID="replay-walkthrough"
        >
          <Text style={styles.actionTitle}>Replay walkthrough</Text>
          <Text style={styles.actionSub}>Run the first-time tour of the tabs and buttons again.</Text>
        </Pressable>
```

If the component's `db` is not already in scope, take it from the existing `useDb()` call at the top of the screen.

- [ ] **Step 7: Run the new test**

Run: `npx jest --testPathIgnorePatterns=".claude" src/__tests__/onboarding-targets.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 8: Run the full suite and typecheck**

Run: `npx tsc --noEmit && npx jest --testPathIgnorePatterns=".claude"`
Expected: PASS across both projects. Pay attention to `src/__tests__/home.test.tsx`, `transactions.test.tsx` and `settings.test.tsx` if they exist — the `TourTarget` `View` adds a node to those trees, and any query that depended on an exact parent-child shape has to be adjusted (adjust the query, never delete the assertion).

- [ ] **Step 9: Commit**

```bash
git add src/app/\(tabs\)/index.tsx src/app/\(tabs\)/transactions.tsx src/app/settings.tsx src/db/settingsRepo.ts src/__tests__/onboarding-targets.test.tsx
git commit -m "feat: spotlight real elements and add a walkthrough replay row"
```

---

## Self-Review

**Spec coverage:** step data (Task 2) · reducer (Task 1) · provider, registry, tab navigation, 600ms fallback, first-run gate, flag writes (Task 3) · SVG cutout, tooltip, Back/Next/Skip, touch swallowing, Android back (Task 4) · root-layout mounting above the tab bar (Task 5) · targets on Home and Transactions, Settings replay row (Task 6). Tests named in the spec map to Tasks 1, 3, 4 and 6 — the spec's `onboarding-fallback.test.tsx` is folded into `onboarding-overlay.test.tsx` as its last case, since it needs the same fixture.

**Deferred from the spec, deliberately:** the reduce-motion-aware fade and the focus-move on step change. Both are polish on top of a working overlay and neither has a test that would catch its absence; do them as a follow-up rather than smuggling untested behavior into Task 4.

**Naming check:** `tourReducer`/`isLastStep`/`INITIAL_TOUR_STATE` (Task 1) are consumed under those exact names in Task 3. `registerTarget`/`unregisterTarget`/`rect`/`resolving` (Task 3) are consumed under those names in Tasks 4 and 6. Target ids in Task 2 match the wrappers in Task 6 one for one.
