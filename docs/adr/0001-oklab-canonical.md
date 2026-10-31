# 0001 — Store colour as OKLab, not a hue-carrying model

Status: accepted. Backfilled 2026-10-31 from `AGENTS.md` and `docs/COLOR.md`;
alternatives are reconstructed from the constraints, not from a contemporaneous
record.

## Context

Every picker model (OKLCH, OKHSV, OKHSL, CIELAB, CIELCH, HelmGen, HelmGen LCH) has
to share one stored value, and switching the model must not move the colour.

## Decision

The canonical value is OKLab (`L`, `a`, `b`) plus a **hue anchor**. OKLCH and
every other view are derived for display.

## Why

- A rectangular space has no hue at `C = 0`, so a hue-carrying source of truth
  needs an anchor for greys anyway — it buys nothing.
- Round-trips through every registered model must be exact and invisible; one
  hub means one conversion graph and one test surface.

## Rejected

- **LCH/HSL as the canonical value** — hue is undefined at zero chroma, and
  deriving lightness and chroma back out of a polar form cannot round-trip a grey
  exactly.
- **Per-model stored values** — every model would need its own conversion path,
  and the round-trip suite would no longer cover one shared hub.

## Consequences

- Every model converts through OKLab; `test/color-models.test.js` covers the
  lineup automatically.
- Appearance is rendered from the stored Lab, never by re-deriving LCH — a
  standing invariant, because a re-derivation would make the swap visible.

## Detail

`AGENTS.md` → Invariants; `docs/COLOR.md`.
