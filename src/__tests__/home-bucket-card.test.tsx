import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { buckets } from '@/db/schema';
import { createTestDb, TestDb } from '@/db/testDb';
// babel-plugin-jest-hoist lifts the jest.mock() calls below above these imports,
// so the screen's transitive expo-router / DbProvider imports are already mocked
// when it loads.
import HomeScreen from '@/app/(tabs)/index';

let mockTestDb: TestDb;
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));
jest.mock('@/db/DbProvider', () => ({
  useDb: () => ({ db: mockTestDb, version: 0, refresh: jest.fn(), catchUp: null }),
}));

// See transactions-list.test.tsx — cold transform cache versus the 1000ms default.
configure({ asyncUtilTimeout: 10000 });

beforeEach(() => {
  mockTestDb = createTestDb();
  mockPush.mockClear();
});

describe('bucket cards', () => {
  it('opens the transactions tab filtered to the bucket', async () => {
    const [gcash] = await mockTestDb.insert(buckets).values({ name: 'GCash' }).returning();

    render(<HomeScreen />);
    // The card's accessibilityLabel is what a screen reader reads, so it is
    // also the honest handle for the press.
    const card = await waitFor(() => screen.getByLabelText(/^GCash,/));
    fireEvent.press(card);

    expect(mockPush).toHaveBeenCalledTimes(1);
    const [arg] = mockPush.mock.calls[0];
    expect(arg.pathname).toBe('/(tabs)/transactions');
    expect(arg.params.bucketId).toBe(String(gcash.id));
    // The nonce is what makes a second press on the same card a new request.
    expect(arg.params.at).toEqual(expect.any(String));
  });

  it('gives two presses on the same card distinct requests', async () => {
    await mockTestDb.insert(buckets).values({ name: 'GCash' }).returning();
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(1000).mockReturnValueOnce(2000);

    render(<HomeScreen />);
    const card = await waitFor(() => screen.getByLabelText(/^GCash,/));
    fireEvent.press(card);
    fireEvent.press(card);

    expect(mockPush.mock.calls[0][0].params.at).not.toBe(mockPush.mock.calls[1][0].params.at);
    nowSpy.mockRestore();
  });
});
