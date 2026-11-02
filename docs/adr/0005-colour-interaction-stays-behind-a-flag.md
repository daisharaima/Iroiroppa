# 0005 — The colour interaction protocol stays behind a flag

Status: accepted 2026-11-02 (sunset 2026-12-01).

## Context

A live colour drag sends a write per pointer move; main coalesces them and the host
echoes each value back. A drag that also receives an external colour change (an
eyedropper, a hotkey) can theoretically interleave those two writers.

The app now has an explicit protocol — `begin`, ordered `update`, `end`
(commit or cancel), and `reject` when the host invalidates the gesture — verified
live: one begin, twelve ordered updates, one commit, zero rejects, and a real
invalidation after a Colour Wheel drag in Clip Studio Paint.

## Decision

Ship it off by default (`--local-first`) with no acknowledgements and no origin
tag, and set a sunset date. Keep the code only if a real user-visible loss shows up
before then.

## Why

No reproducible failure justifies it. The guarded scenario needs two writers at
once; with one pointer it is unproven rather than impossible. A protocol nobody
needs is a maintenance cost on every future colour change, and the code path is
small enough to delete cleanly.

## Rejected

- **Turn it on by default because it is "more correct"** — correctness without a
  symptom is a claim, not evidence, and the flag-off path is what users run.
- **Extend it (acks, origin tags, retries)** — that is speculative work on an
  unproven surface.

## Consequences

If a release ships with zero invalidation reports by 2026-12-01, delete the module
and its channels rather than carrying them.
