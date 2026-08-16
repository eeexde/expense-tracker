import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { utang } from '@/db/schema';
import { createTestDb, TestDb } from '@/db/testDb';
// babel-plugin-jest-hoist lifts the jest.mock() calls below above these
// imports, so the screen's transitive expo-router / DbProvider imports are
// already mocked when it loads.
import UtangScreen from '@/app/(tabs)/utang';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: (...args: unknown[]) => mockPush(...args) }),
}));

let mockTestDb: TestDb;
jest.mock('@/db/DbProvider', () => ({
  useDb: () => ({ db: mockTestDb, version: 0, refresh: jest.fn(), catchUp: null }),
}));

beforeEach(() => {
  mockTestDb = createTestDb();
  mockPush.mockClear();
});

/** One open debt (nothing paid against it) belonging to `person`. */
async function seedOpenDebt(person: string) {
  await mockTestDb
    .insert(utang)
    .values({ personName: person, direction: 'iOwe', originalAmount: 50000 })
    .returning();
}

/**
 * An open debt's tap goes to pay-utang, which offers neither edit nor delete;
 * both of those live behind edit-utang, and the only route there used to be
 * `onLongPress` on the card. A long press is not a gesture TalkBack can be
 * relied on to produce, so an open debt could not be corrected or removed at
 * all with a screen reader on. The query below is deliberately
 * `getByRole('button', { name })` rather than a testID: what this defends is
 * precisely that the route exists *as an announced button*.
 */
describe('utang open-debt actions', () => {
  it('routes to edit-utang from a labelled button, not only a long press', async () => {
    await seedOpenDebt('Aling Nena');

    await render(<UtangScreen />);
    await waitFor(() => expect(screen.getByText('Aling Nena')).toBeTruthy());

    await fireEvent.press(screen.getByRole('button', { name: 'Edit Aling Nena' }));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/edit-utang',
      params: { id: expect.any(String) },
    });
  });

  it('keeps a plain tap on the row going to pay-utang', async () => {
    await seedOpenDebt('Aling Nena');

    await render(<UtangScreen />);
    await waitFor(() => expect(screen.getByText('Aling Nena')).toBeTruthy());

    // The new Edit button must not have stolen the row's own action: paying is
    // still the common case and still what tapping the card does.
    await fireEvent.press(
      screen.getByRole('button', { name: /^Record a payment for Aling Nena/ }),
    );

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/pay-utang',
      params: { id: expect.any(String) },
    });
  });
});
