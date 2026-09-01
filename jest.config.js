/**
 * Two projects: fast node tests for pure logic/db, jest-expo for components.
 * testRegex (not testMatch): repo may live under a dot-directory (.claude
 * worktrees), and jest's glob matching silently skips dot-dir paths.
 */
module.exports = {
  /**
   * Jest's default (cpus - 1) spawns ~19 workers here, and each `ui` worker
   * loads a full react-native sandbox. That overcommits memory long before it
   * overcommits CPU: a default run took 173s, and once 640s, against 13s in
   * band — almost all of it paging. Capping restores ~26s.
   *
   * This does NOT cure the "worker process has failed to exit gracefully"
   * warning, which still shows up intermittently (~3 runs in 5, `logic` only).
   * That one is a jest-worker artifact — a child that misses the 500ms exit
   * grace period gets force-killed — not a test leak: `--detectOpenHandles`
   * reports nothing, and closing every better-sqlite3 handle in an `afterAll`
   * measurably changed nothing. It is cosmetic; results are unaffected.
   */
  maxWorkers: '50%',
  projects: [
    {
      displayName: 'logic',
      testEnvironment: 'node',
      testMatch: null,
      testRegex: 'src[\\\\/](lib|db)[\\\\/].*\\.test\\.ts$',
      transform: {
        '^.+\\.ts$': [
          'ts-jest',
          {
            tsconfig: {
              module: 'commonjs',
              moduleResolution: 'node',
              target: 'ES2022',
              strict: true,
              esModuleInterop: true,
              skipLibCheck: true,
              types: ['jest', 'node'],
            },
          },
        ],
      },
    },
    {
      displayName: 'ui',
      preset: 'jest-expo',
      testMatch: null,
      testRegex: '\\.test\\.tsx$',
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ui.js'],
      transformIgnorePatterns: [
        'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|react-native-gifted-charts|gifted-charts-core)',
      ],
    },
  ],
};
