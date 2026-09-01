import { render, screen, waitFor } from '@testing-library/react-native';
import { buckets, recurring } from '@/db/schema';
import { recordChainEvent, setFallbackBuckets } from '@/db/recurringRepo';
import { createTestDb, TestDb } from '@/db/testDb';
// Hoisted above these imports by babel-plugin-jest-hoist, so the screen's
// transitive expo-router / DbProvider imports are already mocked when it loads.
import RecurringScreen from '@/app/(tabs)/recurring';

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));

let mockTestDb: TestDb;
jest.mock('@/db/DbProvider', () => ({
  useDb: () => ({ db: mockTestDb, version: 0, refresh: jest.fn(), catchUp: null }),
}));

beforeEach(() => {
  mockTestDb = createTestDb();
});

/** A rule from `Cash`, with `Cash → GCash` as its chain when asked for one. */
async function seedRule(withFallback: boolean) {
  const made = await mockTestDb
    .insert(buckets)
    .values([{ name: 'Cash' }, { name: 'GCash' }])
    .returning();
  const [cash, gcash] = made.map((b) => b.id);
  const [rule] = await mockTestDb
    .insert(recurring)
    .values({
      name: 'Rent',
      amount: 500000,
      bucketId: cash,
      frequency: 'monthly',
      dayDue: 1,
      startDate: '2026-03-01',
    })
    .returning();
  if (withFallback) await setFallbackBuckets(mockTestDb, rule.id, cash, [gcash]);
  return { ruleId: rule.id, cash, gcash };
}

/**
 * A skipped due writes no transaction anywhere, so this list is the only place
 * it can be seen at all — which is what these cover.
 *
 * Every `render` here is awaited, and must be. RNTL 14's `render` is `async`
 * and only publishes the result to the module-level `screen` (via
 * `setRenderResult`) *after* its internal `await act(...)` resolves. Drop the
 * await and `screen` is still the default stub when the assertions start, so
 * every query throws "`render` function has not been called" — and `waitFor`
 * cannot save it, because `waitFor` has its own 1s budget that jest's
 * `testTimeout` does not raise. It looked like a passing test only because the
 * pending render usually wins that 1s; on a cold transform cache it does not,
 * which is why the first test in the file was the one that flaked.
 */
describe('the recurring list and its bucket chain', () => {
  it('names the single bucket a rule without fallbacks draws from', async () => {
    await seedRule(false);
    await render(<RecurringScreen />);
    await waitFor(() => expect(screen.getByText('Cash')).toBeTruthy());
  });

  it('shows the whole chain, in order', async () => {
    await seedRule(true);
    await render(<RecurringScreen />);
    await waitFor(() => expect(screen.getByText('Cash → GCash')).toBeTruthy());
  });

  it('warns about a due no bucket could cover', async () => {
    const { ruleId } = await seedRule(true);
    await recordChainEvent(mockTestDb, {
      recurringId: ruleId,
      date: '2026-03-01',
      kind: 'skipped',
      bucketId: null,
      amount: 500000,
    });

    await render(<RecurringScreen />);

    await waitFor(() =>
      expect(
        screen.getByText(/2026-03-01 not posted — no bucket could cover/),
      ).toBeTruthy(),
    );
  });

  it('says which fallback bucket paid a due', async () => {
    const { ruleId, gcash } = await seedRule(true);
    await recordChainEvent(mockTestDb, {
      recurringId: ruleId,
      date: '2026-03-01',
      kind: 'fallback',
      bucketId: gcash,
      amount: 500000,
    });

    await render(<RecurringScreen />);

    await waitFor(() => expect(screen.getByText('2026-03-01 paid from GCash')).toBeTruthy());
  });
});
