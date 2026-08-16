import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
// babel-plugin-jest-hoist lifts every jest.mock() below above these imports, so
// the native modules `client.ts` pulls in are already stubbed when it loads.
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { backupDatabaseFile, DbOpenError, isDbOpenError, openAppDb } from '@/db/client';

/* --------------------------------------------------------------------------
 * Everything native, mocked at the boundary
 *
 * `client.ts` is the one module that touches the driver, the migrator and the
 * filesystem at once, and all three are stubbed here so the *decisions* it
 * makes are what the tests see. Names are `mock`-prefixed because
 * babel-plugin-jest-hoist lifts these factories above every import and only
 * lets that prefix through.
 * ------------------------------------------------------------------------ */

const mockExecSync = jest.fn();
/** Stands in for `SELECT max(created_at) FROM __drizzle_migrations`. */
let mockAppliedRow: { created_at: number | null } | null = null;
let mockMigrationsTableMissing = false;
const mockGetFirstSync = jest.fn(() => {
  if (mockMigrationsTableMissing) throw new Error('no such table: __drizzle_migrations');
  return mockAppliedRow;
});
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({ execSync: mockExecSync, getFirstSync: mockGetFirstSync }),
}));

/** The newest migration this "build" ships. */
const mockBundledWhen = Date.UTC(2026, 0, 15);
jest.mock('../../drizzle/migrations', () => ({
  __esModule: true,
  default: {
    journal: { entries: [{ when: Date.UTC(2025, 10, 1) }, { when: Date.UTC(2026, 0, 15) }] },
    migrations: {},
  },
}));

const mockDrizzleInstance = { __brand: 'db' };
jest.mock('drizzle-orm/expo-sqlite', () => ({ drizzle: () => mockDrizzleInstance }));

const mockMigrate = jest.fn(async () => {});
jest.mock('drizzle-orm/expo-sqlite/migrator', () => ({
  migrate: (...args: unknown[]) => mockMigrate(...(args as [])),
}));

const mockSeed = jest.fn(async () => {});
jest.mock('@/db/seed', () => ({ seedIfEmpty: (...args: unknown[]) => mockSeed(...(args as [])) }));

let mockDbFileExists = true;
const mockCopy = jest.fn(async () => {});
const mockDelete = jest.fn();
jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    get exists() {
      // Only the real database is ever on disk here; the cache copy is not.
      return this.uri.endsWith('/kuripot.db') ? mockDbFileExists : false;
    }
    delete = mockDelete;
    copy = mockCopy;
  }
  return {
    File: MockFile,
    Paths: { document: { uri: 'file:///doc' }, cache: { uri: 'file:///cache' } },
  };
});

const mockSharingAvailable = jest.fn(async () => true);
const mockShareAsync = jest.fn(async () => {});
jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => mockSharingAvailable(),
  shareAsync: (uri: string, options: unknown) => mockShareAsync(uri, options),
}));

beforeEach(() => {
  mockAppliedRow = null;
  mockMigrationsTableMissing = false;
  mockMigrate.mockClear();
  mockMigrate.mockResolvedValue(undefined);
  mockSeed.mockClear();
  mockSeed.mockResolvedValue(undefined);
  mockExecSync.mockClear();
  mockDbFileExists = true;
  mockCopy.mockClear();
  mockDelete.mockClear();
  mockShareAsync.mockClear();
  mockSharingAvailable.mockResolvedValue(true);
});

/* ==========================================================================
 * FINDING 3 — a downgrade silently accepting a newer database
 *
 * drizzle's migrator compares one number: the newest `created_at` already in
 * `__drizzle_migrations` against each bundled migration's `folderMillis`. An
 * older build opening a database a newer build migrated therefore runs none of
 * its own migrations and reports success, and the incompatibility surfaces
 * later as an unrelated SQL error on some unrelated screen.
 *
 * `openAppDb` never memoizes a failed open, so every test below can call it.
 * ========================================================================== */

describe('opening a database from a different build', () => {
  it('refuses a database written by a newer build, before migrating anything', async () => {
    mockAppliedRow = { created_at: Date.UTC(2026, 5, 1) }; // months past this build

    await expect(openAppDb()).rejects.toThrow(/newer version of Kuripot/);
    // The point of failing at the door: nothing gets to touch the schema.
    expect(mockMigrate).not.toHaveBeenCalled();
    expect(mockSeed).not.toHaveBeenCalled();
  });

  it('names both schema dates so the user knows which build to reinstall', async () => {
    mockAppliedRow = { created_at: Date.UTC(2026, 5, 1) };

    const error = await openAppDb().catch((e: unknown) => e);

    expect(isDbOpenError(error)).toBe(true);
    expect((error as DbOpenError).stage).toBe('newer-schema');
    expect((error as DbOpenError).detail).toContain('2026-06-01');
    expect((error as DbOpenError).detail).toContain('2026-01-15');
  });

  it('lets a database at this build own schema through', async () => {
    mockAppliedRow = { created_at: mockBundledWhen }; // equal, not newer
    // Fails at the *next* stage instead, which is how this test can prove the
    // guard let it past without leaving a memoized db behind for the others.
    mockSeed.mockRejectedValueOnce(new Error('seed exploded'));

    const error = await openAppDb().catch((e: unknown) => e);

    expect(mockMigrate).toHaveBeenCalled();
    expect((error as DbOpenError).stage).toBe('seed');
  });

  it('treats a database with no migrations table as a fresh install', async () => {
    mockMigrationsTableMissing = true;
    mockSeed.mockRejectedValueOnce(new Error('seed exploded'));

    await openAppDb().catch(() => {});

    expect(mockMigrate).toHaveBeenCalled();
  });
});

/* ==========================================================================
 * FINDING 2 — no in-app recovery from a real migration failure
 * ========================================================================== */

describe('a migration that genuinely fails', () => {
  it('says which step failed and carries the driver message with it', async () => {
    mockMigrate.mockRejectedValueOnce(new Error('no such column: transactions.note'));

    const error = await openAppDb().catch((e: unknown) => e);

    expect(isDbOpenError(error)).toBe(true);
    expect((error as DbOpenError).stage).toBe('migrate');
    // Plain sentence for the screen, driver text kept for "Show details".
    expect((error as DbOpenError).message).toMatch(/could not upgrade its database/i);
    expect((error as DbOpenError).detail).toBe('no such column: transactions.note');
  });

  it('copies the raw database file out without needing a migrated schema', async () => {
    const saved = await backupDatabaseFile('2026-08-16');

    expect(saved).toBe(true);
    // Un-checkpointed WAL frames would be missing from the copy.
    expect(mockExecSync).toHaveBeenCalledWith('PRAGMA wal_checkpoint(TRUNCATE);');
    expect(mockCopy).toHaveBeenCalled();
    expect(mockShareAsync).toHaveBeenCalledWith(
      'file:///cache/kuripot-database-2026-08-16.db',
      expect.anything(),
    );
  });

  it('reports a device that cannot share rather than claiming a save', async () => {
    mockSharingAvailable.mockResolvedValueOnce(false);

    await expect(backupDatabaseFile('2026-08-16')).resolves.toBe(false);
    expect(mockShareAsync).not.toHaveBeenCalled();
  });

  it('refuses when there is no database file to copy', async () => {
    mockDbFileExists = false;

    await expect(backupDatabaseFile('2026-08-16')).rejects.toThrow(/No Kuripot database file/);
  });
});

/* ==========================================================================
 * The recovery screen
 *
 * "Try again" re-runs the identical open, so on a genuinely broken database it
 * loops for ever and the only other way out — reinstalling — destroys every
 * peso of history, with no cloud copy anywhere. The escape hatch has to be on
 * this screen.
 * ========================================================================== */

const Boom = ({ error }: { error: Error }) => {
  throw error;
};

async function renderBoundary(error: Error) {
  return render(
    <ErrorBoundary>
      <Boom error={error} />
    </ErrorBoundary>,
  );
}

describe('the recovery screen for a database that will not open', () => {
  let consoleError: jest.SpyInstance;
  beforeEach(() => {
    // React logs every caught boundary error, and so does the boundary itself.
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => consoleError.mockRestore());

  const dbError = () =>
    new DbOpenError(
      'migrate',
      'Kuripot could not upgrade its database to this version.',
      'no such column: transactions.note',
    );

  it('offers the database file for export, and shares it when pressed', async () => {
    await renderBoundary(dbError());

    expect(screen.getByText('Kuripot cannot start')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('backup-db-file'));

    await waitFor(() =>
      expect(mockShareAsync).toHaveBeenCalledWith(
        expect.stringContaining('kuripot-database-'),
        expect.anything(),
      ),
    );
    expect(screen.getByTestId('backup-db-status')).toBeTruthy();
  });

  it('says what failed instead of only that something did', async () => {
    await renderBoundary(dbError());

    expect(screen.getByText('Kuripot could not upgrade its database to this version.')).toBeTruthy();
    // __DEV__ is true under jest, so the detail box starts expanded.
    expect(screen.getByText('no such column: transactions.note')).toBeTruthy();
  });

  it('offers nothing destructive', async () => {
    await renderBoundary(dbError());

    // A "reset" button here would be the one action that cannot be undone on a
    // device whose data exists nowhere else. Queried as a *control*, not as
    // text: the body copy legitimately talks about wiping and deleting.
    expect(
      screen.queryByRole('button', { name: /erase|wipe|delete|reset|start over|clear/i }),
    ).toBeNull();
    // The two it does offer.
    expect(screen.getByText('Save a copy of the database')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  it('tells the user when the export could not happen', async () => {
    mockSharingAvailable.mockResolvedValueOnce(false);
    await renderBoundary(dbError());

    await fireEvent.press(screen.getByTestId('backup-db-file'));

    await waitFor(() =>
      expect(screen.getByTestId('backup-db-status').props.children).toMatch(/no app that can/i),
    );
  });

  it('leaves an ordinary crash on the plain recovery screen', async () => {
    await renderBoundary(new Error('render blew up'));

    expect(screen.getByText('Something broke')).toBeTruthy();
    expect(screen.queryByTestId('backup-db-file')).toBeNull();
    expect(screen.getByText('Try again')).toBeTruthy();
  });
});
