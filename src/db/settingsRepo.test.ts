import { createTestDb } from './testDb';
import { getSetting, setSetting } from './settingsRepo';

describe('settingsRepo', () => {
  it('returns null for unset keys and round-trips values', async () => {
    const db = createTestDb();
    expect(await getSetting(db, 'aiParsingEnabled')).toBeNull();
    await setSetting(db, 'aiParsingEnabled', 'true');
    expect(await getSetting(db, 'aiParsingEnabled')).toBe('true');
    await setSetting(db, 'aiParsingEnabled', 'false');
    expect(await getSetting(db, 'aiParsingEnabled')).toBe('false');
  });
});
