/**
 * The first `render()` in a file pays to transform the whole react-native
 * module graph, and that happens inside the test body, so it is billed to the
 * test's own clock rather than to setup. Against jest's 5s default that is a
 * coin flip on a cold cache — i.e. every CI run, on a 2-core runner that
 * `maxWorkers: '50%'` reduces to a single worker. Cold locally these suites
 * already reach ~11s.
 *
 * Set here rather than as a `testTimeout` key on the project: jest rejects
 * that as an unknown option inside `projects` (it is only read from the root
 * config, which explicit project configs do not inherit), so the raised
 * ceiling silently never applied and the 5s default stayed in force.
 *
 * Raising the ceiling cannot make a passing test fail; it only stops a slow
 * machine reporting transform time as a timeout.
 */
jest.setTimeout(30000);

/**
 * `react-native-reanimated`'s own `mock.js`/`SHOULD_BE_USE_WEB` fallback
 * (4.5.0) still pulls in `react-native-worklets`, which throws
 * (`loadUnpackers` on an undefined native module) the instant it is
 * required under jest — its native/web split has no jest branch of its own.
 * `TourOverlay`'s step fade only needs a shared value, a style hook, and a
 * timing helper that resolves synchronously, so this stands in for the
 * whole package rather than fighting the real one's native init path.
 */
jest.mock('react-native-reanimated', () => {
  const { useRef } = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (initial) => useRef({ value: initial }).current,
    useAnimatedStyle: (factory) => factory(),
    withTiming: (toValue) => toValue,
    withSpring: (toValue) => toValue,
    cancelAnimation: () => {},
  };
});
