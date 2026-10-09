# Vercel and the branch split

## The split

| Branch | Holds | Deploys to Vercel? |
|---|---|---|
| `master` | The landing site (`index.html`, `download.html`, `api/`) | **Yes.** Its own `vercel.json` sets `buildCommand: ""` and `outputDirectory: "."` |
| `main` | The Electron app | No |
| `feat/*` | The Electron app | No |

## Why git deployments are off on the app branches

The repository root on an app branch is an Electron project. `npm run build`
there runs `electron-vite build`, which writes to `out/` — a main process
bundle, a preload bundle, and a renderer. There is no `dist/`, and nothing in
`out/` is a website.

So a Vercel build triggered from an app branch installs 667 packages, rebuilds
native modules, compiles 2,485 modules for about 25 seconds, and then fails:

```
Error: No Output Directory named "dist" found after the Build completed.
```

It cannot succeed, because there is nothing for it to serve. Every push to an
app branch was paying for that and producing a failed deployment.

The previous `vercel.json` disabled only `main`, so the failure moved to
whichever feature branch was being worked on — `feat/community-platform` hit it
on 2026-08-26.

`"deploymentEnabled": false` turns off git deployments for **every** branch that
carries this file.

## Why this does not affect the landing site

`vercel.json` is read from the branch being deployed. `master` has its own copy,
which this file is not. Turning deployments off here cannot turn them off there.

Confirm with:

```bash
git show origin/master:vercel.json
```

## Deploying the landing site

From `master`, using the CLI rather than a git push:

```bash
vercel --prod
```

## Releasing the app

Not Vercel at all. Push a `v*` tag and GitHub Actions builds all three
platforms into a draft release, then publishes it once every platform
succeeds. See [releasing-and-auto-update.md](releasing-and-auto-update.md).
