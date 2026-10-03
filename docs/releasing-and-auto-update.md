# Releasing & Auto-Update

AIHub Browser auto-updates from **GitHub Releases** via `electron-updater`.
Installed apps check for a newer published release on startup and every 6 hours,
notify the user in-app, and (on their click) download and install it — no
uninstall/reinstall needed.

## How it works

- `package.json` → `build.publish` points at `github: pitchiluxe/aihub-browser`.
- CI (`.github/workflows/release.yml`) verifies the project, builds Windows,
   macOS and Linux on a `v*` tag, then publishes the GitHub Release only after
   every platform build succeeds. Each build uploads its installer, `.blockmap`
   and update manifest (`latest.yml`, `latest-mac.yml` or `latest-linux.yml`).
- The app (`src/main/updater.ts`) reads that manifest, compares versions, and
  drives the in-app toast (`UpdateNotification.tsx`): Download → progress →
  "Restart to update".

electron-updater **ignores draft/pre-release** entries. The release workflow
publishes automatically after its verification and all platform builds pass.

## Cutting a release

1. Bump the version in `package.json` (e.g. `1.3.0` → `1.3.1`). The tag **must**
   match: tag `v1.3.1` ↔ `"version": "1.3.1"`.
2. Commit and push to the app branch.
3. Tag and push the tag:
   ```bash
   git tag v1.3.1
   git push origin v1.3.1
   ```
4. The release workflow verifies, builds all three platforms, uploads their
   artifacts and publishes `v1.3.1` once every build succeeds.
5. Within a few hours (or on next launch) installed Windows apps show
   *"Update available — Download"*, then *"Restart to update"*.

## Platform support

| OS | Auto-update | Notes |
|----|-------------|-------|
| **Windows (NSIS)** | ✅ Works | No signing required (SmartScreen may warn on first install). |
| **Linux (AppImage)** | ✅ Works | Requires the app to have been launched from the AppImage. |
| **macOS** | ⚠️ Needs signing | Squirrel.Mac only updates **signed + notarized** apps. Current mac builds are unsigned, so mac users update manually from the release page. `latest-mac.yml` is still published, so once you add an Apple Developer ID cert + notarization, mac auto-update works with no code changes. |

## Testing auto-update locally

Auto-update is **disabled in dev** (`app.isPackaged === false`). To test the real
flow: install version N from a published release, then publish N+1 and relaunch
the installed app — the toast should appear. (You can't test it from `npm run dev`.)

## Requirements / gotchas

- The repo must be reachable by clients. For a **public** repo this needs no
  token. For a **private** repo, auto-update requires shipping a token, which is
  not recommended — keep the repo public or distribute another way.
- Do **not** commit any Personal Access Token. CI uses the automatic
  `secrets.GITHUB_TOKEN`, which already has `contents: write` here.
- The version in a tag and in `package.json` must match, or the release/tag
  association breaks.
