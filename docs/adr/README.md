# Architecture Decision Records

One short file per decision that chose one option over another at a cost. The
prose docs stay authoritative for *how things work*; an ADR records *why this way
and not the other way*.

## Rules

- **One decision per file**, named `NNNN-kebab-title.md`, numbered from `0001` in
  four digits. Numbers are never reused or renumbered.
- **Short.** Aim for half a page. The owning doc carries the detail; the ADR links
  to it.
- **A snapshot, not a spec.** Accepted ADRs are never rewritten. To change a
  decision, add a new ADR that says `Supersedes NNNN` and update the owning doc.
  Rewriting an accepted ADR destroys the record of what was true then.
- **Write one only when there was a real alternative.** A rule with no rejected
  option belongs in `docs/INVARIANTS.md` or `AGENTS.md`, not here.
- **Backfilled ADRs are labelled.** If it was reconstructed from existing docs
  rather than written when the decision was made, say so in the status line: the
  rejected alternatives may be the ones the constraints imply, not the ones
  actually considered at the time.

## Shape

```markdown
# NNNN — the decision in one line

Status: accepted (2026-01-01). Backfilled from … (optional).

## Context
What forced a choice.

## Decision
What was chosen.

## Why
The constraints that made it right.

## Rejected
- **The other option** — why it lost.

## Consequences
What this commits us to, including the cost.

## Detail
Links to the owning docs and the tests that pin it.
```

## Index

| ADR | Decision |
| --- | --- |
| [0001](0001-oklab-canonical.md) | Store colour as OKLab, not a hue-carrying model |
| [0002](0002-colour-echo-by-identity.md) | Suppress colour echoes by identity, not by time |
| [0003](0003-single-layout-writer.md) | Main is the only writer of `layout.json` |
