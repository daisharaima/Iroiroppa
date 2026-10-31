# 0002 — Suppress colour echoes by identity, not by time

Status: accepted. Backfilled 2026-10-31 from `AGENTS.md` and `docs/STATE.md`.

## Context

Every write is broadcast back to every window, and CSP also reports the colour it
holds. Somewhere, an incoming value that is really our own echo has to be dropped
— otherwise a window re-applies its own write and the hue rotates.

## Decision

Drop an incoming colour only when it matches what we wrote or what it replaced.
Any other value is a real change and is accepted.

## Why

- A time window cannot tell our echo from the user's eyedropper pick; it swallows
  genuine changes that happen to arrive soon after a write.
- A lagging read-back can still land after the window, so time is the wrong axis
  anyway: the value itself is the evidence.

## Rejected

- **A suppression window measured in milliseconds** — indistinguishable from a
  real change, and it fails as soon as a read-back is slower than the window.
- **Suppressing anything that re-arrives while a write is in flight** — the host
  push may be the eyedropper; only identity, not timing, separates the two.

## Consequences

A poll that was in flight when a host push arrived is treated as stale and
discarded; a value that reverts to the colour just changed away from is read-back
lag and is ignored briefly. Main remains the only history writer, so a throttled
renderer settle cannot commit an older pick after a newer one.

## Detail

`AGENTS.md` → Invariants; `docs/STATE.md`.
