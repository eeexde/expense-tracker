/**
 * Two projects: fast node tests for pure logic/db, jest-expo for components.
 * testRegex (not testMatch): repo may live under a dot-directory (.claude
 * worktrees), and jest's glob matching silently skips dot-dir paths.
 */
module.exports = {
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
      transformIgnorePatterns: [
        'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|react-native-gifted-charts|gifted-charts-core)',
      ],
    },
  ],
};
