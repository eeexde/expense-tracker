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
