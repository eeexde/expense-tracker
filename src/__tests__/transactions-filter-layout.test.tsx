import { render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { createTestDb, TestDb } from '@/db/testDb';
// babel-plugin-jest-hoist lifts the jest.mock() calls below above these imports,
// so the screen's transitive expo-router / DbProvider imports are already mocked
// when it loads.
import TransactionsScreen from '@/app/(tabs)/transactions';

let mockTestDb: TestDb;
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock('@/db/DbProvider', () => ({
  useDb: () => ({ db: mockTestDb, version: 0, refresh: jest.fn(), catchUp: null }),
}));

beforeEach(() => {
  mockTestDb = createTestDb();
});

/**
 * Regression guard for the clipped filter chips. jest cannot run Yoga, so the
 * assertions are on the two style properties that made the difference rather
 * than on measured pixels:
 *
 * A horizontal ScrollView carries `flexGrow: 1, flexShrink: 1` in its OWN base
 * style, and the FlatList below it defaults to `flexBasis: auto` — i.e. its
 * full content height. A month with enough rows therefore overflowed the
 * column, Yoga shrank every shrinkable sibling to fit, and the chip rows lost
 * the height their labels needed.
 */
describe('transactions filter rows', () => {
  it('marks every chip row unshrinkable', async () => {
    render(<TransactionsScreen />);
    await waitFor(() => expect(screen.getByTestId('filter-type-all')).toBeTruthy());

    for (const prefix of ['filter-type', 'filter-bucket', 'filter-category']) {
      const row = screen.getByTestId(`${prefix}-row`);
      expect(StyleSheet.flatten(row.props.style)).toMatchObject({
        flexGrow: 0,
        flexShrink: 0,
      });
    }
  });

  it('gives the transaction list a flex basis of its own', async () => {
    render(<TransactionsScreen />);
    await waitFor(() => expect(screen.getByTestId('filter-type-all')).toBeTruthy());

    const list = screen.getByTestId('transaction-list');
    expect(StyleSheet.flatten(list.props.style)).toMatchObject({ flex: 1 });
  });
});
