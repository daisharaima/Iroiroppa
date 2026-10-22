# Contributing to Iroiroppa

Thanks for taking a look. Iroiroppa is a small Windows tool, but it has a few
non-obvious invariants; reading this page and the linked docs before changing
code saves a lot of time.

## Set up

Requires **Node 18+** (developed on Node 24) and Windows 10/11.

```bash
npm install
npm test        # node:test suite, no Electron needed (~2 seconds)
npm run dev     # run the app with devtools
npm run screenshot   # regenerate docs/screenshot.png
npm run pack:run     # build and launch the packaged app
```

`npm run map [filter]` prints a file/line index instead of reading whole files.
`docs/DEV.md` lists the `--shot`/dev flags used to verify the UI without a human
clicking.

## Where the docs are

| Doc | Covers |
| --- | --- |
| `docs/ARCHITECTURE.md` | source layout, process split, who owns what |
| `docs/COLOR.md` | OKLab/OKLCH, gamut intervals, ICC proofing |
| `docs/INVARIANTS.md` | the regressions that must not come back |
| `docs/LAYOUT.md` | palettes, floats, snapping, the layout document |
| `docs/MODULES.md` | the module platform and capability model |
| `docs/PROTOCOL.md` | the Companion protocol field notes |
| `docs/STATE.md` | the canonical state model, adapters and session layer |
| `docs/THEMES.md` | themes and the token manifest |
| `docs/USER-MODULES.md` | writing a user module |
| `docs/RELEASE.md` | versioning, tags, release notes |
| `AGENTS.md` | the short working guide for AI agents |

## Invariants in one minute

- **OKLab is canonical; OKLCH is a view.** Render from the stored Lab and keep the
  hue anchor at `C = 0`.
- **Gamut tolerance is magnitude-relative**, and the boundary is a union of chroma
  intervals — do not replace it with a binary search from zero.
- **Main owns shared state and `layout.json`.** Windows mirror; a board reads and
  writes only its own palette.
- **A colour echo is suppressed only when it matches what was written or replaced**,
  never by time alone.
- **Never send to a destroyed `webContents`**; use `src/main/broadcast.js`.
- **A theme's CSS paints; it does not change geometry.** Structural tokens trigger
  one re-measure.

The full list is in `AGENTS.md` and `docs/INVARIANTS.md`.

## Branches and releases

- `dev` is day-to-day work; short-lived branches off it are squash-merged to keep
  history linear.
- `main` is the released line. A release is a `vX.Y.Z` tag cut from `main`; the tag
  triggers CI to build and publish.
- The version moves only at release, in `package.json` and `package-lock.json`.
- Every release has `release-notes/vX.Y.Z.md`. Write it from
  `release-notes/TEMPLATE.md`, highlights first, then Added / Changed / Fixed /
  Removed, then Install / Requirements. `npm test` checks the structure.

## Code style

- CommonJS, 2-space indentation, no renderer build step.
- Tests live next to the layers they cover. Prefer a synthetic fixture (for example
  `src/shared/synthetic-icc.js`) over a machine-specific file.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
- New runtime dependencies need a reason; the app currently carries `jsqr` and
  `jscolorengine`.

## Privacy and test data

Do not commit:

- `%APPDATA%\Iroiroppa` data — `settings.json`, `session.json`, layouts, history or
  user modules;
- a real ICC profile, screenshot of someone's canvas, or personal file path;
- logs, build output or generated screenshots from a real session.

The screenshot recipe uses Adobe RGB (1998) and a fake host; it must stay that way.

## Pull requests and issues

- Small, focused changes are easiest to review. Include the test result and, for UI
  changes, a regenerated `docs/screenshot.png`.
- Bug reports are welcome. Include the app version, Windows version, CSP version,
  and what you expected versus what happened.
- The project is licensed GPL-3.0-or-later; contributions are accepted under the
  same licence.

Iroiroppa is unofficial and not affiliated with CELSYS, Inc.
