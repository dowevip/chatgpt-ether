# Changelog

## 2026-06-27

### Added

- Added outside-click dismissal for the ChatGPT Ether floating workspace panel while keeping the existing top-right close button behavior.

### Fixed

- Fixed TypeScript typecheck failures in sync payload sanitization, captured ChatGPT timeline nodes, injected conversation capture, timeline message locating, popup starred-message conversation checks, and shared storage keys.
- Fixed `GoogleDriveSyncService.signOut()` so the cached Chrome identity token is removed once while still revoking the token.
- Updated language tests to match the current supported language set: Simplified Chinese and English.
- Updated Google Drive sync authentication tests to match the current Chrome native `identity.getAuthToken` flow.

### Changed

- Cleaned `bun.lock` so it matches the current `package.json` dependency set and removes stale dependencies that are no longer used by the extension.

### Verified

- `bun install --frozen-lockfile`
- `bun run test`
- `bun run typecheck`
- `bun run build:chrome`
