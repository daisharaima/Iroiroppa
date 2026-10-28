---
name: Release
description: Cut an Iroiroppa release — version bump, CHANGELOG, tag, CI, release notes. Use when bumping the version, tagging or publishing a release, or changing the release process.
---

Cutting a release follows the maintainer's private checklist. The rules that are
never to be broken:

- **The version moves only at release.** One bump, in the release commit, in
  `package.json` *and* `package-lock.json` (`npm version --no-git-tag-version
  X.Y.Z` updates both and deliberately makes no tag). During development the app
  reports the last released number; changes accumulate under `[Unreleased]` in
  `CHANGELOG.md`.
- **A `v*` tag is the whole release.** It triggers CI to build and publish; never
  build or upload by hand, and never move a published tag. Tags do not ride along
  with `git push` — push `vX.Y.Z` explicitly.
- **Tagging and any major bump need the maintainer's explicit go-ahead.**
- Release notes are for users (What's new / Install / Requirements), and **Adobe
  RGB (1998) is the only colour profile they may ever name**.
