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

describe('LLM fallback on medium confidence', () => {
  const NOW = '2026-07-13T08:00:00.000Z';
  const mediumEntry = {
    packageName: 'com.globe.gcash.android',
    title: null,
    text: 'Transaction alert: PHP 99.00 JOLLIBEE ref 555',
    postedAt: NOW,
    key: 'llm1',
  };

  it('classifier direction upgrades a medium item to committed', async () => {
    const db = createTestDb();
    await setup(db);
    const classify = jest.fn().mockResolvedValue({ direction: 'income', merchant: 'JOLLIBEE' });
    const summary = await ingestCaptured(db, [mediumEntry], NOW, classify);
    expect(classify).toHaveBeenCalledWith(mediumEntry.text, 9900);
    expect(summary.committed).toBe(1);
    expect(summary.queued).toBe(0);
    const [txn] = await db.select().from(transactions);
    expect(txn.type).toBe('income');
    expect(txn.note).toBe('JOLLIBEE');
    const [row] = await db.select().from(pendingNotifications);
    expect(row.status).toBe('committed');
  });

  it('classifier null keeps the item in the inbox', async () => {
    const db = createTestDb();
    await setup(db);
    const classify = jest.fn().mockResolvedValue(null);
    const summary = await ingestCaptured(db, [mediumEntry], NOW, classify);
    expect(summary.queued).toBe(1);
    expect(await db.select().from(transactions)).toHaveLength(0);
  });

  it('classifier is not called for high or no-amount items', async () => {
    const db = createTestDb();
    await setup(db);
    const classify = jest.fn();
    await ingestCaptured(
      db,
      [
        { ...mediumEntry, key: 'llm2', text: 'You have sent PHP 10.00 to X.' },
        { ...mediumEntry, key: 'llm3', text: 'Promo! 20% off this weekend' },
      ],
      NOW,
      classify,
    );
    expect(classify).not.toHaveBeenCalled();
  });

  it('classifier throwing does not break ingest — item queues', async () => {
    const db = createTestDb();
    await setup(db);
    const classify = jest.fn().mockRejectedValue(new Error('native crash'));
    const summary = await ingestCaptured(db, [mediumEntry], NOW, classify);
    expect(summary.queued).toBe(1);
  });

  it('uses the LLM merchant only when regex found none', async () => {
    const db = createTestDb();
    await setup(db);
    // regex finds no merchant in this text but does find amount → medium
    const classify = jest.fn().mockResolvedValue({ direction: 'expense', merchant: 'LLM STORE' });
    await ingestCaptured(db, [{ ...mediumEntry, key: 'llm4', text: 'Alert: PHP 42.00 processed' }], NOW, classify);
    const [txn] = await db.select().from(transactions);
    expect(txn.type).toBe('expense');
    expect(txn.note).toBe('LLM STORE');
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
