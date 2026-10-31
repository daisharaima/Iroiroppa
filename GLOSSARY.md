# GLOSSARY.md

Internal vocabulary for this repo. The linked doc is authoritative for the
detail; this file is the index, not a second definition. The wiki is the
user-facing guide, so the last column records the wording it may use — a dash
means the concept stays internal and must not appear there.

| Term | Meaning here | User-facing wording |
| --- | --- | --- |
| displayed space | OKLCH, the space the picker's axes describe. See `AGENTS.md` → What this is. | — |
| recorded values | The raw channel numbers CSP stores; their meaning comes from the document's embedded profile, not from the wire. See `AGENTS.md` → What this is, `docs/COLOR.md`. | — |
| palette | A window holding a board of modules; more than one can be open, and each has an id in the workspace document. See `docs/LAYOUT.md`, `docs/STATE.md`. | Palette |
| float | A palette detached into its own window; in schema v2 it is just another palette, not a separate window kind. See `docs/LAYOUT.md`. | Float |
| board | The column layout inside one palette, together with its pure geometry and reducer. See `docs/LAYOUT.md`. | — |
| module | One panel in a palette (a picker, the session controls, history, …); each selector module is one file, with settings keyed by its id. See `docs/MODULES.md`. | Module |
| slice | The Color Slices module's 2D plane at a fixed axis; the two free channels name it. See `docs/MODULES.md`, `AGENTS.md` → Invariants. | — (the module is "Color Slices") |
| guide | The contour drawn at the locked lightness; while Shift-locked it is also the pick. See `AGENTS.md` → Invariants. | — |
| cusp | A hue's most colourful colour at a lightness; the wheel's outer ring is the document's cusp, fitted. See `docs/COLOR.md`, `AGENTS.md` → Invariants. | — |
| pick | A colour the user commits to CSP, and so to history, as opposed to a live preview. See `AGENTS.md` → Invariants, `docs/STATE.md`. | — |
| workspace | A named, saved arrangement of palettes and modules. See `docs/ARCHITECTURE.md` → State on disk. | Workspace |
| proofing | Previewing a colour through another profile without changing the document. See `docs/COLOR.md`. | Proofing |

Renaming a term means updating this table **and** `wiki/Glossary.md` in the same
commit; the wiki uses only the user-facing wording.
