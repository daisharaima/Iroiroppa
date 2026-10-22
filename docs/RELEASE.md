# Releasing

How a version is cut, and who does what. `AGENTS.md` keeps only the
non-negotiable rules, and the `release` skill points here; this file is the
checklist and the *why*.

## Branches

- **`main`** — the released line and the repository's default branch. It should
  always be the code of the newest release, so only release-worthy changes land
  here; a tag is cut from it.
- **`dev`** — day-to-day development. Work lands here first, then fast-forwards
  `main` when a release is cut.
- Short-lived branches off `dev` for anything non-trivial, squash-merged back;
  keep the history linear (no merge commits).
- When a version is released from a branch other than `main`, fast-forward `main`
  to it afterwards so the default branch keeps meaning "latest stable".
- CI runs on every push and on pull requests; a tag runs the Release workflow.

## The version moves only at release

- During development `package.json` keeps the **last released** number, and a
  dev run (`npm run dev`) reports it. Changes accumulate under `[Unreleased]` in
  `CHANGELOG.md`; a dev build's version legitimately lags the tree.
- A bump happens once, in the release commit, in **both** `package.json` and
  `package-lock.json`. The safe form is `npm version --no-git-tag-version X.Y.Z`,
  which updates both and deliberately creates no tag.
- **Tagging and any major bump need the maintainer's explicit go-ahead.** The
  maintainer labels changes feature vs bugfix as we work; the agent infers the
  rest (fixing broken behaviour = patch, new capability = minor, cleanup = patch).

## Tagging is the whole release

`.github/workflows/release.yml` runs on any `v*` tag: it installs, tests, builds
the NSIS installer and the portable exe on `windows-latest`, then creates or
updates the GitHub release with those assets. The body comes from the checked-in
`release-notes/vX.Y.Z.md` file — the workflow refuses a tag without one.

## Checklist

```bash
# 1. write release-notes/vX.Y.Z.md from release-notes/TEMPLATE.md
# 2. make the tree release-worthy
npm test                                   # no Electron needed
npm run screenshot                         # only if the palette UI changed
# 3. bump the version in package.json AND package-lock.json, update CHANGELOG
npm version --no-git-tag-version X.Y.Z
git commit -am "chore(release): vX.Y.Z"
git push origin main
# 4. tag: CI does the build and the release
git tag -a vX.Y.Z -m "Iroiroppa vX.Y.Z"
git push origin vX.Y.Z
# 5. check the result
gh run watch                               # the Release workflow
gh release view vX.Y.Z                     # both assets should be listed
```

## The CHANGELOG and the release notes

One dated CHANGELOG section per version — never a second one for the same number.
`[Unreleased]` grows as changes land; at release its whole block is renamed to
`## [X.Y.Z] — <YYYY-MM-DD>` and a fresh empty `[Unreleased]` opens above it. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Each release also has `release-notes/vX.Y.Z.md`, written before the tag. Its
first section is `## Highlights` — the most important change first — followed by
`## Added`, `## Changed`, `## Fixed`, `## Removed`, an optional `## Internal`, then
`## Install` and `## Requirements`. Bullets are one or two short sentences; every
user-visible change gets one. `npm test` enforces the structure, and the release
workflow publishes the file verbatim.

## Rules that keep this predictable

- **Never build and upload by hand.** If the tag's build fails, fix the cause on
  `main` and tag again (a *new* patch version). A published tag is immutable —
  never `push --force` a tag, and never move one. Tags do not ride along with
  `git push`; push `vX.Y.Z` explicitly.
- **Versioning is semver**: patch for fixes, minor for features, major when a
  release breaks someone's setup (a settings/layout format change, a rename, a
  licence change). The project is 1.x; a breaking change still gets a major bump or
  a clear note in the release.
- **Pre-releases** use a `-beta.N` suffix; CI marks them `--prerelease` so
  `latest` stays the stable build.
- **Assets** are named `Iroiroppa.Setup.<version>.exe` and
  `Iroiroppa-Portable-<version>.exe` (the portable name comes from
  `build.portable.artifactName`). Check the release page; keep the README's install
  instructions and the `package.json` version in step.
- Builds are **unsigned**, so Windows shows a SmartScreen warning — every release
  body must say so (and nothing else about the build).
- **Release notes are for users**: highlights first, then the classified lists,
  then Install / Requirements. No test counts, dev flags, the probe, the repo
  layout, the roadmap, the parked list, private notes or other release-engineering
  detail — that lives in `AGENTS.md` and here. The only colour profile that may
  ever be named is **Adobe RGB (1998)**.
- **Smoke-test the packaged app once** per release (`dist/win-unpacked` or the
  portable exe): dev Electron and the built app are different programs, and the
  packaged one is what users get.

## Before every non-beta release

Re-read the README top to bottom and check it against the app: the feature list,
the install steps and asset names, the credits list (each source on its own line)
and the AI disclosure. It is the one document users actually read, and the release
workflow assumes it is current.
