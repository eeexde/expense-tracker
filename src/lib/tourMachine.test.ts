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
