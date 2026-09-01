# Kuripot — repo rules

- **Never put `.test.tsx`/`.test.ts` files under `src/app/`.** Metro bundles everything in that directory as expo-router routes; a test importing `src/db/testDb.ts` (node-only, uses `path`) breaks the EAS "Bundle JavaScript" phase even though jest passes. Screen tests go in `src/__tests__/`, importing the screen via `@/app/<name>`.
- Money columns are integer centavos; date columns are `'YYYY-MM-DD'` local strings (`pending_notifications.postedAt` is the one exception: ISO UTC).
- Migrations: edit `src/db/schema.ts`, then `npx drizzle-kit generate`. Never hand-write SQL in `drizzle/`.
- New tables must be added to `TABLES` in `src/db/dataTransfer.ts` (FK-safe order) or backup restore breaks with FK violations.
- Local Expo modules (`modules/*/android/build.gradle`) need `defaultConfig { versionCode / versionName }` and must not use valueless `return@Function` in the module DSL — both fail only in the EAS gradle build, not locally.
- Run tests **from the repo root** with `--testPathIgnorePatterns=".claude"` when Claude worktrees exist, else duplicate suites run. Inside a worktree that flag matches *everything* (the worktree's own path contains `.claude`) and jest reports "No tests found" — from a worktree, run plain `npx jest`.
- Per-project `testTimeout` in `jest.config.js` is rejected by jest ("Unknown option") and silently leaves the 5s default. Set timeouts via a project `setupFilesAfterEnv` file calling `jest.setTimeout()`.
- After sideload-updating the APK on device, Android unbinds the notification listener: toggle Kuripot's Notification access off/on.
