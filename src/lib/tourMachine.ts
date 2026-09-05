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
