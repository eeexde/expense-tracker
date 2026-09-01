import { DuplicateCandidate, duplicateTransactionIds } from './duplicates';

let nextId = 1;
function txn(partial: Partial<DuplicateCandidate> = {}): DuplicateCandidate {
  return {
    id: nextId++,
    type: 'expense',
    amount: 25000,
    date: '2026-07-04',
    ...partial,
  };
}

beforeEach(() => {
  nextId = 1;
});

describe('duplicateTransactionIds', () => {
  it('flags every row of a same-amount same-date group', () => {
    const a = txn();
    const b = txn();
    const c = txn();
    expect(duplicateTransactionIds([a, b, c])).toEqual(new Set([a.id, b.id, c.id]));
  });

  it('leaves a lone row and near-misses alone', () => {
    const rows = [
      txn({ amount: 25000, date: '2026-07-04' }),
      txn({ amount: 25000, date: '2026-07-05' }), // same amount, other day
      txn({ amount: 25001, date: '2026-07-04' }), // one centavo apart
    ];
    expect(duplicateTransactionIds(rows).size).toBe(0);
  });

  it('never pairs rows of different types', () => {
    const rows = [
      txn({ type: 'expense' }),
      txn({ type: 'income' }),
      txn({ type: 'transfer' }),
    ];
    expect(duplicateTransactionIds(rows).size).toBe(0);
  });

  it('skips recurring and installment postings', () => {
    const rent = txn({ recurringId: 3 });
    const rentAgain = txn({ recurringId: 3 });
    const due = txn({ installmentId: 7 });
    const dueAgain = txn({ installmentId: 8 });
    expect(duplicateTransactionIds([rent, rentAgain, due, dueAgain]).size).toBe(0);
  });

  it('skips linked transfer fees, which are one per transfer by construction', () => {
    // Two ₱1,000 transfers on one day, each charged the same ₱15 — an ordinary
    // day of moving money, not a double entry.
    const feeA = txn({ amount: 1500, feeForTransactionId: 1 });
    const feeB = txn({ amount: 1500, feeForTransactionId: 2 });
    expect(duplicateTransactionIds([feeA, feeB]).size).toBe(0);
  });

  it('still pairs a fee-shaped expense the user typed by hand', () => {
    // No link means nobody vouches for it — the rule applies as usual.
    const a = txn({ amount: 1500 });
    const b = txn({ amount: 1500 });
    expect(duplicateTransactionIds([a, b])).toEqual(new Set([a.id, b.id]));
  });

  it('does not pair a manual entry with the posting it mirrors', () => {
    const posted = txn({ recurringId: 3 });
    const byHand = txn();
    expect(duplicateTransactionIds([posted, byHand]).size).toBe(0);
  });

  it('groups in one pass over the input', () => {
    // 20k distinct amounts on one date: an O(n^2) pairwise scan would not
    // return in test time.
    const rows = Array.from({ length: 20000 }, (_, i) =>
      txn({ amount: 1000 + i, date: '2026-07-04' }),
    );
    expect(duplicateTransactionIds(rows).size).toBe(0);
  });
});
