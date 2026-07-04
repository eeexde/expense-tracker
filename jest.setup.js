// jest-expo doesn't yet mock the native WorkletsModule that Reanimated 4
// depends on, so any test importing a component that pulls in
// react-native-reanimated crashes on require(). Swap in Reanimated's
// official jest mock instead.
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
