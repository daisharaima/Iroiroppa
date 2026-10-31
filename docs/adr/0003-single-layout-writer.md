# 0003 — Main is the only writer of `layout.json`

Status: accepted (schema v2). Backfilled 2026-10-31 from `docs/LAYOUT.md` and
`AGENTS.md`.

## Context

The palette's board kept a layout, each float kept its own, and main kept another
copy. Two writers — the renderer's debounced save and main's `report()` — each
read-modify-wrote the whole document, so one could silently clobber the other
(the lost update).

## Decision

Main owns the workspace document. Renderers dispatch intents; main validates,
reduces and broadcasts a revision-stamped snapshot. Nothing else reads and
rewrites `layout.json`.

## Why

Correctness needs one owner: with three copies, nothing was authoritative and they
were reconciled by convention, which is how the same bug kept returning in a new
combination.

## Rejected

- **Renderer-owned persistence with main relaying** — it still needs a second copy
  in main, which is exactly how the copies diverged.
- **A separate board store beside the service** — `board-store.js` was removed;
  the service is the only path.

## Consequences

- Every mutation is an intent; the reducer and geometry are pure and headless-tested.
- A snapshot or delta with a stale revision is dropped, so a delta racing the
  hydrate snapshot survives.
- A privileged channel acts only for a live window it resolves, never for a
  window id taken from the payload.

## Detail

`docs/LAYOUT.md` → Principles; `docs/STATE.md`; `AGENTS.md` → Invariants.
