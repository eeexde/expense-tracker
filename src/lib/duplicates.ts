/**
 * Just the columns the rule reads. Structural, so a `Transaction` row passes
 * without this module having to pull the schema (and drizzle with it) into the
 * node test project.
 */
export interface DuplicateCandidate {
  id: number;
  type: 'expense' | 'income' | 'transfer';
  amount: number;
  date: string;
  recurringId?: number | null;
  installmentId?: number | null;
}

/**
 * Ids of transactions that look like an accidental double entry.
 *
 * The rule is the user's: same amount AND same date. Two exclusions keep it
 * from crying wolf on rows the data model already explains:
 *
 * - **Different types never pair.** A ₱500 transfer and a ₱500 expense on the
 *   same day are two different kinds of event, not one typed twice. Bundling
 *   the type into the key also keeps a transfer from pairing with itself once
 *   the transactions list shows it under both of its buckets (see
 *   `listTransactions`) — it is one row, surfaced twice.
 * - **Machine-posted rows are skipped.** A row carrying `recurringId` or
 *   `installmentId` was written by the poster, which already guards against
 *   posting a due twice; when the user *also* logs the same rent or amortization
 *   by hand that is a legitimate pair to reconcile, not a typo, and the two
 *   dues of two ₱2,000 plans falling on the same day are not duplicates at all.
 *
 * One pass with a Map — the caller renders per row and must not re-scan there.
 */
export function duplicateTransactionIds(txns: readonly DuplicateCandidate[]): Set<number> {
  const byKey = new Map<string, number[]>();
  for (const txn of txns) {
    if (txn.recurringId != null || txn.installmentId != null) continue;
    const key = `${txn.type}|${txn.amount}|${txn.date}`;
    const ids = byKey.get(key);
    if (ids) ids.push(txn.id);
    else byKey.set(key, [txn.id]);
  }
  const duplicates = new Set<number>();
  for (const ids of byKey.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) duplicates.add(id);
  }
  return duplicates;
}
