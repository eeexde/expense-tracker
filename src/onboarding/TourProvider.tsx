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
import { INITIAL_TOUR_STATE, TourAction, tourReducer } from '@/lib/tourMachine';
import { ONBOARDING_COMPLETED_KEY, Rect, TAB_PATHNAMES, TOUR_STEPS, TourStep } from './tourSteps';

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
  const next = useCallback(() => rawDispatch({ type: 'next' }), []);

  const back = useCallback(() => rawDispatch({ type: 'back' }), []);

  const skip = useCallback(() => rawDispatch({ type: 'skip' }), []);

  const start = useCallback(() => rawDispatch({ type: 'start' }), []);

  // ---- persist completion ---------------------------------------------------
  // Deriving this from `state.completed` (rather than checking `isLastStep`
  // inside `next`/`skip` at click time) survives two `next()` calls landing in
  // the same batch — e.g. a same-tick double press — where the second click's
  // closure would otherwise still see the pre-click index and wrongly decide
  // the tour was not finishing. The reducer's own transition is always
  // computed against its true current state, so watching its result here is
  // the reliable signal.
  const wasCompleted = useRef(state.completed);
  useEffect(() => {
    if (state.completed && !wasCompleted.current) markCompleted();
    wasCompleted.current = state.completed;
  }, [state.completed, markCompleted]);

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

  // A replay must not open against rects measured during the previous run —
  // the tab that was on screen when the tour ended may not be the tab a fresh
  // run's first target lives on. Only clear on the true -> false transition
  // (not on the initial mount, when nothing has registered yet but a target
  // under this same tree may already be mid-registration in its own effect).
  const wasActive = useRef(state.active);
  useEffect(() => {
    if (!state.active && wasActive.current) setRects({});
    wasActive.current = state.active;
  }, [state.active]);

  // ---- navigation ----------------------------------------------------------
  // Each step declares its tab as a group-qualified href — what
  // `router.navigate` needs. `usePathname()` strips the group segment, so the
  // comparison that guards re-navigation has to go through `TAB_PATHNAMES`
  // instead of comparing the href directly against `pathname`.
  useEffect(() => {
    if (!step) return;
    if (pathname !== TAB_PATHNAMES[step.tab]) router.navigate(step.tab);
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
