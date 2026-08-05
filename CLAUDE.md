# Kuripot — repo rules

- **Never put `.test.tsx`/`.test.ts` files under `src/app/`.** Metro bundles everything in that directory as expo-router routes; a test importing `src/db/testDb.ts` (node-only, uses `path`) breaks the EAS "Bundle JavaScript" phase even though jest passes. Screen tests go in `src/__tests__/`, importing the screen via `@/app/<name>`.
- Money columns are integer centavos; date columns are `'YYYY-MM-DD'` local strings (`pending_notifications.postedAt` is the one exception: ISO UTC).
- Migrations: edit `src/db/schema.ts`, then `npx drizzle-kit generate`. Never hand-write SQL in `drizzle/`.
- New tables must be added to `TABLES` in `src/db/dataTransfer.ts` (FK-safe order) or backup restore breaks with FK violations.
- Local Expo modules (`modules/*/android/build.gradle`) need `defaultConfig { versionCode / versionName }` and must not use valueless `return@Function` in the module DSL — both fail only in the EAS gradle build, not locally.
- Run tests from repo root with `--testPathIgnorePatterns=".claude"` when Claude worktrees exist, else duplicate suites run.
- **Never assert a sqlite constraint with `expect(...).rejects.toThrow()`** — use `expectConstraintError()` from `src/db/testDb.ts`. better-sqlite3's `SqliteError` comes from the native addon, which node caches per process, while jest gives each test file its own realm: the error class belongs to whichever file first opened a db, so everywhere else `err instanceof Error` is false and `toThrow()` reports "did not throw" even though the constraint fired. Only the file order decides who loses, so it presents as a flake.
- After sideload-updating the APK on device, Android unbinds the notification listener: toggle Kuripot's Notification access off/on.
