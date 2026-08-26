import { createTestDb, TestDb } from './testDb';
import { buckets, categories, pendingNotifications, transactions } from './schema';
import { addExpense } from './repo';
import {
  addCategoryRule,
  addSource,
  commitPending,
  discardPending,
  expirePending,
  ingestCaptured,
  listPending,
  matchCategory,
  notifDedupKey,
  updateSource,
} from './notificationRepo';

async function setup(db: TestDb) {
  const [bucket] = await db.insert(buckets).values({ name: 'GCash' }).returning();
  const source = await addSource(db, {
    bucketId: bucket.id,
    packageName: 'com.globe.gcash.android',
  });
  return { bucket, source };
}

const NOW = '2026-07-10T08:00:00.000Z';

describe('notifDedupKey', () => {
  it('is identical for identical content regardless of native key/postTime', () => {
    const a = notifDedupKey('com.bank', 'BPI', 'You paid PHP 10.00');
    const b = notifDedupKey('com.bank', 'BPI', 'You paid PHP 10.00');
    expect(a).toBe(b);
  });

  it('differs when package, title, or text differ', () => {
    const base = notifDedupKey('com.bank', 'BPI', 'You paid PHP 10.00');
    expect(notifDedupKey('com.other', 'BPI', 'You paid PHP 10.00')).not.toBe(base);
    expect(notifDedupKey('com.bank', 'BDO', 'You paid PHP 10.00')).not.toBe(base);
    expect(notifDedupKey('com.bank', 'BPI', 'You paid PHP 20.00')).not.toBe(base);
  });

  it('handles a null title without colliding with an empty-title message', () => {
    expect(notifDedupKey('com.bank', null, 'text')).not.toBe(
      notifDedupKey('com.bank', '', 'other text'),
    );
    expect(() => notifDedupKey('com.bank', null, 'text')).not.toThrow();
  });
});

describe('content-based dedup (app reposts / notification updates)', () => {
  it('does not double-log when the app reposts the same notification with a new native key', async () => {
    const db = createTestDb();
    await setup(db);
    const text = 'You have sent PHP 10.00 to X.';
    const first = {
      packageName: 'com.globe.gcash.android',
      title: 'GCash',
      text,
      postedAt: NOW,
      key: 'native-1#1000',
    };
    // Same email, Gmail-style repost: identical content, different native key + postTime.
    const reposted = { ...first, key: 'native-1#2000', postedAt: '2026-07-10T08:00:05.000Z' };
    const s1 = await ingestCaptured(db, [first], NOW);
    const s2 = await ingestCaptured(db, [reposted], NOW);
    expect(s1.committed).toBe(1);
    expect(s2.committed).toBe(0);
    expect(s2.skipped).toBe(1);
    expect(await db.select().from(transactions)).toHaveLength(1);
  });

  it('still logs genuinely different notifications from the same app', async () => {
    const db = createTestDb();
    await setup(db);
    const a = {
      packageName: 'com.globe.gcash.android',
      title: 'GCash',
      text: 'You have sent PHP 10.00 to X.',
      postedAt: NOW,
      key: 'n1',
    };
    const b = { ...a, key: 'n2', text: 'You have sent PHP 20.00 to Y.' };
    await ingestCaptured(db, [a, b], NOW);
    expect(await db.select().from(transactions)).toHaveLength(2);
  });
});

describe('ingestCaptured', () => {
  it('high confidence commits a transaction immediately', async () => {
    const db = createTestDb();
    await setup(db);
    const summary = await ingestCaptured(
      db,
      [
        {
          packageName: 'com.globe.gcash.android',
          title: 'GCash',
          text: 'You have sent PHP 150.00 to JOLLIBEE via GCash.',
          postedAt: NOW,
          key: 'k1',
        },
      ],
      NOW,
    );
    expect(summary.committed).toBe(1);
    const txns = await db.select().from(transactions);
    expect(txns).toHaveLength(1);
    expect(txns[0].amount).toBe(15000);
    expect(txns[0].type).toBe('expense');
    expect(txns[0].sourceNotifKey).toBe(
      notifDedupKey('com.globe.gcash.android', 'GCash', 'You have sent PHP 150.00 to JOLLIBEE via GCash.'),
    );
    expect(txns[0].date).toBe('2026-07-10');
    const rows = await db.select().from(pendingNotifications);
    expect(rows[0].status).toBe('committed');
  });

  it('medium confidence goes to the inbox', async () => {
    const db = createTestDb();
    await setup(db);
    const summary = await ingestCaptured(
      db,
      [
        {
          packageName: 'com.globe.gcash.android',
          title: null,
          text: 'Transaction alert: PHP 99.00 JOLLIBEE ref 123',
          postedAt: NOW,
          key: 'k2',
        },
      ],
      NOW,
    );
    expect(summary.queued).toBe(1);
    expect(await db.select().from(transactions)).toHaveLength(0);
    const pending = await listPending(db);
    expect(pending).toHaveLength(1);
    expect(pending[0].parsedAmount).toBe(9900);
  });

  it('no amount is stored discarded (dedup) with no transaction', async () => {
    const db = createTestDb();
    await setup(db);
    const summary = await ingestCaptured(
      db,
      [
        {
          packageName: 'com.globe.gcash.android',
          title: null,
          text: 'Enjoy 20% off this weekend!',
          postedAt: NOW,
          key: 'k3',
        },
      ],
      NOW,
    );
    expect(summary.discarded).toBe(1);
    expect(await listPending(db)).toHaveLength(0);
    const rows = await db.select().from(pendingNotifications);
    expect(rows[0].status).toBe('discarded');
  });

  it('unmapped package and duplicate keys are skipped', async () => {
    const db = createTestDb();
    await setup(db);
    const entry = {
      packageName: 'com.globe.gcash.android',
      title: null,
      text: 'You have sent PHP 10.00 to X.',
      postedAt: NOW,
      key: 'k4',
    };
    await ingestCaptured(db, [entry], NOW);
    const second = await ingestCaptured(
      db,
      [entry, { ...entry, key: 'k5', packageName: 'com.other.app' }],
      NOW,
    );
    expect(second.committed).toBe(0);
    expect(second.skipped).toBe(2);
    expect(await db.select().from(transactions)).toHaveLength(1);
  });

  it('matchKeyword source only claims matching text', async () => {
    const db = createTestDb();
    const [b1] = await db.insert(buckets).values({ name: 'Card 1111' }).returning();
    const [b2] = await db.insert(buckets).values({ name: 'Card 2222' }).returning();
    await addSource(db, { bucketId: b1.id, packageName: 'com.bank', matchKeyword: '1111' });
    await addSource(db, { bucketId: b2.id, packageName: 'com.bank', matchKeyword: '2222' });
    await ingestCaptured(
      db,
      [
        {
          packageName: 'com.bank',
          title: 'Bank',
          text: 'Card ending 2222 charged PHP 50.00 at STORE.',
          postedAt: NOW,
          key: 'k6',
        },
      ],
      NOW,
    );
    const [txn] = await db.select().from(transactions);
    expect(txn.bucketId).toBe(b2.id);
  });

  it('applies category rules on commit', async () => {
    const db = createTestDb();
    await setup(db);
    const [cat] = await db
      .insert(categories)
      .values({ name: 'Eating Out', type: 'expense' })
      .returning();
    await addCategoryRule(db, { keyword: 'jollibee', categoryId: cat.id });
    await ingestCaptured(
      db,
      [
        {
          packageName: 'com.globe.gcash.android',
          title: null,
          text: 'You have sent PHP 150.00 to JOLLIBEE.',
          postedAt: NOW,
          key: 'k7',
        },
      ],
      NOW,
    );
    const [txn] = await db.select().from(transactions);
    expect(txn.categoryId).toBe(cat.id);
  });
});

/**
 * The LLM is the AUTHORITY on whether a notification is a transaction at all —
 * the rules parser cannot tell "Spend ₱1,000, get ₱100 back" from a receipt, so
 * every item that carries a currency-marked amount goes past the model first.
 */
describe('LLM as transaction authority', () => {
  const NOW = '2026-07-13T08:00:00.000Z';
  const mediumEntry = {
    packageName: 'com.globe.gcash.android',
    title: null,
    text: 'Transaction alert: PHP 99.00 JOLLIBEE ref 555',
    postedAt: NOW,
    key: 'llm1',
  };
  // Reads as a high-confidence expense to the regex ("pay" + an amount) and
  // dodges the promotional word list — exactly the bogus auto-commit only the
  // model can stop.
  const disguisedPromo = {
    ...mediumEntry,
    key: 'llm-promo',
    text: 'Reminder: you can pay your Meralco bill of PHP 1,234.56 right in the GCash app.',
  };
  const txn = (opts: Partial<{ direction: string; merchant: string | null; amount: number }> = {}) =>
    jest.fn().mockResolvedValue({
      isTransaction: true,
      direction: opts.direction ?? 'income',
      merchant: opts.merchant ?? 'JOLLIBEE',
      amountCentavos: opts.amount ?? 9900,
    });

  it('is handed the full candidate list, not a single amount', async () => {
    const db = createTestDb();
    await setup(db);
    const classify = txn();
    await ingestCaptured(db, [mediumEntry], NOW, classify);
    expect(classify).toHaveBeenCalledWith(mediumEntry.text, [9900]);
  });

  it('isTransaction:false discards a promo the regex would have auto-committed', async () => {
    const db = createTestDb();
    await setup(db);
    const classify = jest.fn().mockResolvedValue({
      isTransaction: false,
      direction: 'expense',
      merchant: null,
      amountCentavos: 0,
    });
    const summary = await ingestCaptured(db, [disguisedPromo], NOW, classify);
    expect(classify).toHaveBeenCalledWith(disguisedPromo.text, [123456]);
    expect(summary.discarded).toBe(1);
    expect(summary.committed).toBe(0);
    expect(summary.queued).toBe(0);
    // No money invented, and nothing left in the inbox for the user to triage.
    expect(await db.select().from(transactions)).toHaveLength(0);
    const [row] = await db.select().from(pendingNotifications);
    expect(row.status).toBe('discarded');
  });

  it('commits with the amount the model picked, not the first regex hit', async () => {
    const db = createTestDb();
    await setup(db);
    // "PHP 50.00 fee ... PHP 1,200.00 sent": the real amount is the second one.
    const entry = {
      ...mediumEntry,
      key: 'llm-pick',
      text: 'Service fee PHP 50.00. Amount PHP 1,200.00 sent to ALING NENA.',
    };
    const classify = txn({ direction: 'expense', merchant: null, amount: 120000 });
    const summary = await ingestCaptured(db, [entry], NOW, classify);
    expect(classify).toHaveBeenCalledWith(entry.text, [5000, 120000]);
    expect(summary.committed).toBe(1);
    const [row] = await db.select().from(transactions);
    expect(row.amount).toBe(120000);
    expect(row.type).toBe('expense');
  });

  it('upgrades a medium item to committed', async () => {
    const db = createTestDb();
    await setup(db);
    const summary = await ingestCaptured(db, [mediumEntry], NOW, txn());
    expect(summary.committed).toBe(1);
    expect(summary.queued).toBe(0);
    const [row] = await db.select().from(transactions);
    expect(row.type).toBe('income');
    expect(row.note).toBe('JOLLIBEE');
    const [pending] = await db.select().from(pendingNotifications);
    expect(pending.status).toBe('committed');
  });

  it('classifier null falls back to the rules path: medium queues', async () => {
    const db = createTestDb();
    await setup(db);
    const classify = jest.fn().mockResolvedValue(null);
    const summary = await ingestCaptured(db, [mediumEntry], NOW, classify);
    expect(summary.queued).toBe(1);
    expect(await db.select().from(transactions)).toHaveLength(0);
  });

  it('classifier null falls back to the rules path: high still auto-commits', async () => {
    const db = createTestDb();
    await setup(db);
    const classify = jest.fn().mockResolvedValue(null);
    const summary = await ingestCaptured(
      db,
      [{ ...mediumEntry, key: 'llm-high', text: 'You have sent PHP 10.00 to X.' }],
      NOW,
      classify,
    );
    expect(summary.committed).toBe(1);
    const [row] = await db.select().from(transactions);
    expect(row.amount).toBe(1000);
  });

  it('classifier is not called when the text has no candidate amount', async () => {
    const db = createTestDb();
    await setup(db);
    const classify = jest.fn();
    const summary = await ingestCaptured(
      db,
      [{ ...mediumEntry, key: 'llm3', text: 'Promo! 20% off this weekend' }],
      NOW,
      classify,
    );
    expect(classify).not.toHaveBeenCalled();
    expect(summary.discarded).toBe(1);
  });

  it('classifier throwing does not break ingest — item falls back to the rules', async () => {
    const db = createTestDb();
    await setup(db);
    const classify = jest.fn().mockRejectedValue(new Error('native crash'));
    const summary = await ingestCaptured(db, [mediumEntry], NOW, classify);
    expect(summary.queued).toBe(1);
  });

  it('uses the LLM merchant only when regex found none', async () => {
    const db = createTestDb();
    await setup(db);
    const classify = txn({ direction: 'expense', merchant: 'LLM STORE', amount: 4200 });
    await ingestCaptured(
      db,
      [{ ...mediumEntry, key: 'llm4', text: 'Alert: PHP 42.00 processed' }],
      NOW,
      classify,
    );
    const [row] = await db.select().from(transactions);
    expect(row.type).toBe('expense');
    expect(row.note).toBe('LLM STORE');
  });

  /**
   * No model (iOS, not downloaded, or every inference timing out) is the whole
   * reason the promotional heuristic still exists.
   */
  it('with no classifier at all, a promo blast is discarded by the heuristic', async () => {
    const db = createTestDb();
    await setup(db);
    const summary = await ingestCaptured(
      db,
      [
        {
          ...mediumEntry,
          key: 'llm-noai',
          text: 'GCash: Get up to PHP 500 cashback when you pay your bills this weekend!',
        },
      ],
      NOW,
    );
    expect(summary.discarded).toBe(1);
    expect(summary.committed).toBe(0);
    expect(await db.select().from(transactions)).toHaveLength(0);
  });
});

/**
 * Ingest is serial, so the model's per-item timeout multiplies by the number of
 * items: a drain after a week away can be hundreds of notifications, and at 5s
 * apiece that is a sync that never visibly ends. LLM_BUDGET_MS caps the whole
 * pass; whatever is left over takes the rules path, exactly as it would on a
 * device with no model at all.
 *
 * Wall clock is faked by driving `performance.now()` from the classifier itself
 * — 6s of "inference" per call — so the assertion is about the budget arithmetic
 * rather than about real elapsed time.
 */
describe('LLM time budget', () => {
  const NOW = '2026-07-13T08:00:00.000Z';
  // High confidence to the rules ("charged" + an amount), so anything the model
  // does not get to still auto-commits — which is what makes the fallback
  // visible in the summary.
  const entries = [1, 2, 3, 4, 5].map((n) => ({
    packageName: 'com.globe.gcash.android',
    title: null,
    text: `Your GCash account was charged PHP ${n}00.00 at STORE ${n}.`,
    postedAt: NOW,
    key: `budget-${n}`,
  }));

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('stops consulting the model once the pass budget is spent', async () => {
    const db = createTestDb();
    await setup(db);

    let clock = 0;
    jest.spyOn(performance, 'now').mockImplementation(() => clock);
    // Every call bills 6s. Budget is 15s, so calls start at 0ms, 6000ms and
    // 12000ms of spend; the fourth item sees 18000 and is never offered.
    const classify = jest.fn(async () => {
      clock += 6_000;
      return { isTransaction: false as const, direction: 'expense' as const, merchant: null, amountCentavos: 0 };
    });

    const summary = await ingestCaptured(db, entries, NOW, classify);

    expect(classify).toHaveBeenCalledTimes(3);
    // The three the model saw were discarded on its say-so; the two it never
    // saw went down the rules path and auto-committed.
    expect(summary.discarded).toBe(3);
    expect(summary.committed).toBe(2);
  });

  it('bills a thrown classifier against the budget too', async () => {
    const db = createTestDb();
    await setup(db);

    let clock = 0;
    jest.spyOn(performance, 'now').mockImplementation(() => clock);
    // A native crash burns the same wall clock as an answer. Billing only the
    // successes would let a device that fails slowly retry forever.
    const classify = jest.fn(async () => {
      clock += 8_000;
      throw new Error('native crash');
    });

    const summary = await ingestCaptured(db, entries, NOW, classify);

    expect(classify).toHaveBeenCalledTimes(2);
    expect(summary.committed).toBe(5);
  });
});

describe('matchCategory', () => {
  it('lower priority wins; case-insensitive contains', () => {
    const rules = [
      { id: 1, keyword: 'store', categoryId: 10, priority: 5 },
      { id: 2, keyword: 'jollibee', categoryId: 20, priority: 0 },
    ];
    expect(matchCategory(rules, 'Paid at JOLLIBEE STORE 3')).toBe(20);
    expect(matchCategory(rules, 'Paid at APP STORE')).toBe(10);
    expect(matchCategory(rules, 'Paid at 7-ELEVEN')).toBeNull();
  });
});

describe('inbox actions + expiry', () => {
  async function queueOne(db: TestDb, key: string, postedAt: string) {
    await ingestCaptured(
      db,
      [
        {
          packageName: 'com.globe.gcash.android',
          title: null,
          text: `Transaction alert: PHP 99.00 ref ${key}`,
          postedAt,
          key,
        },
      ],
      postedAt,
    );
  }

  it('commitPending inserts txn with overrides and marks committed', async () => {
    const db = createTestDb();
    await setup(db);
    await queueOne(db, 'p1', NOW);
    const [pending] = await listPending(db);
    await commitPending(db, pending.id, { amount: 12345, note: 'edited' });
    const [txn] = await db.select().from(transactions);
    expect(txn.amount).toBe(12345);
    expect(txn.note).toBe('edited');
    expect(txn.sourceNotifKey).toBe(
      notifDedupKey('com.globe.gcash.android', null, 'Transaction alert: PHP 99.00 ref p1'),
    );
    expect(await listPending(db)).toHaveLength(0);
  });

  it('discardPending marks discarded', async () => {
    const db = createTestDb();
    await setup(db);
    await queueOne(db, 'p2', NOW);
    const [pending] = await listPending(db);
    await discardPending(db, pending.id);
    expect(await listPending(db)).toHaveLength(0);
    expect(await db.select().from(transactions)).toHaveLength(0);
  });

  it('expirePending commits items older than 2 days, leaves fresh ones', async () => {
    const db = createTestDb();
    await setup(db);
    await queueOne(db, 'old', '2026-07-07T08:00:00.000Z');
    await queueOne(db, 'fresh', '2026-07-09T08:00:00.000Z');
    const summary = await expirePending(db, NOW);
    expect(summary.committed).toBe(1);
    expect(await listPending(db)).toHaveLength(1);
    const txns = await db.select().from(transactions);
    expect(txns).toHaveLength(1);
    expect(txns[0].sourceNotifKey).toBe(
      notifDedupKey('com.globe.gcash.android', null, 'Transaction alert: PHP 99.00 ref old'),
    );
  });

  it('commitPending on a non-pending id rejects', async () => {
    const db = createTestDb();
    await setup(db);
    await queueOne(db, 'p3', NOW);
    const [pending] = await listPending(db);
    await commitPending(db, pending.id);
    await expect(commitPending(db, pending.id)).rejects.toThrow(/no pending notification/i);
    await expect(commitPending(db, 999)).rejects.toThrow(/no pending notification/i);
    expect(await db.select().from(transactions)).toHaveLength(1);
  });

  it('discardPending on an already-committed row is a harmless no-op', async () => {
    const db = createTestDb();
    await setup(db);
    await queueOne(db, 'p4', NOW);
    const [pending] = await listPending(db);
    await commitPending(db, pending.id);
    await discardPending(db, pending.id);
    const [row] = await db.select().from(pendingNotifications);
    expect(row.status).toBe('committed');
    expect(await db.select().from(transactions)).toHaveLength(1);
  });

  it('commitPending recovers when the transaction already exists (no duplicate)', async () => {
    const db = createTestDb();
    const { bucket } = await setup(db);
    await queueOne(db, 'p5', NOW);
    const [pending] = await listPending(db);
    // Simulate a crash after the txn insert but before the status flip.
    await addExpense(db, {
      amount: 9900,
      bucketId: bucket.id,
      date: '2026-07-10',
      sourceNotifKey: pending.notifKey,
    });
    await commitPending(db, pending.id);
    expect(await db.select().from(transactions)).toHaveLength(1);
    const [row] = await db.select().from(pendingNotifications);
    expect(row.status).toBe('committed');
    expect(await listPending(db)).toHaveLength(0);
  });

  it('two overlapping commits of the same row insert exactly one transaction', async () => {
    const db = createTestDb();
    await setup(db);
    await queueOne(db, 'race1', NOW);
    const [pending] = await listPending(db);
    // commitPending is a check-then-insert spanning four awaits, so a second
    // call entering one await behind the first cleared the sourceNotifKey
    // check long before the first one inserted — two transactions, one
    // notification. The inbox screen and the foreground sync both call it.
    const results = await Promise.allSettled([
      commitPending(db, pending.id),
      commitPending(db, pending.id),
    ]);
    expect(await db.select().from(transactions)).toHaveLength(1);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [row] = await db.select().from(pendingNotifications);
    expect(row.status).toBe('committed');
  });

  it('a discard landing mid-commit never logs the transaction it declined', async () => {
    const db = createTestDb();
    await setup(db);
    await queueOne(db, 'race3', NOW);
    const [pending] = await listPending(db);
    // Both buttons sit on the same inbox row, and expirePending fires the same
    // commit from syncNotifications on every foreground. Off the commit chain
    // the discard's UPDATE lands between the commit's checks and its insert:
    // the row flips to 'discarded' and the transaction is inserted anyway —
    // money the user just declined, and unrecoverable, since the row is no
    // longer pending for the idempotent-recovery branch to find.
    const commit = commitPending(db, pending.id).catch(() => undefined);
    // Several microtasks in, i.e. past commitPendingLocked's status and
    // sourceNotifKey checks but before it inserts.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await discardPending(db, pending.id);
    await commit;

    const [row] = await db.select().from(pendingNotifications);
    const txns = await db.select().from(transactions);
    // The commit took the chain first, so it wins outright and the discard is
    // the documented no-op on an already-committed row. What must never happen
    // is the mixed outcome: discarded status with a transaction behind it.
    expect(row.status).toBe('committed');
    expect(txns).toHaveLength(1);
  });

  it('a confirm landing mid-expiry does not double-log the row', async () => {
    const db = createTestDb();
    await setup(db);
    await queueOne(db, 'race2', '2026-07-07T08:00:00.000Z');
    const [pending] = await listPending(db);
    // The stronger path: expirePending auto-commits rows >= 2 days old from
    // syncNotifications on every foreground, and the inbox lists those same
    // rows ("Auto-logs in 0d"). Whichever loses the race must not insert.
    const [expiry, confirmed] = await Promise.all([
      expirePending(db, NOW),
      commitPending(db, pending.id).then(
        () => true,
        () => false,
      ),
    ]);
    expect(await db.select().from(transactions)).toHaveLength(1);
    expect(await listPending(db)).toHaveLength(0);
    // Exactly one side did the commit and the other reported a no-op. `<= 1` on
    // its own cannot fail — one queued row makes `committed` structurally 0 or
    // 1 — so it never caught the loser counting a commit it did not perform.
    expect(expiry.committed + (confirmed ? 1 : 0)).toBe(1);
  });

  it('updateSource rejects an empty package name', async () => {
    const db = createTestDb();
    const { source } = await setup(db);
    await expect(updateSource(db, source.id, { packageName: '  ' })).rejects.toThrow(
      /package name/i,
    );
  });
});
