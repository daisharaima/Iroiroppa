---
name: Theme authoring
description: Author or change an Iroiroppa theme — tokens, the optional CSS that restyles beyond colour, fonts, and the check/preview loop. Use when adding a bundled or user theme, or a theming token.
---

# Theme authoring

A theme is data: `<id>.json` (validated tokens) plus an optional sibling `<id>.css`
(free-form overrides, injected after the base stylesheets). Read `docs/THEMES.md`
and `src/shared/theme-tokens.js` first — the manifest is the source of truth, and
`npm test` fails if the manifest, the bundled themes, the renderer CSS and the doc
disagree.

## The loop

1. **Base** — copy a bundled theme's JSON (and its CSS, if any) to your target and
   set `id`, `name`, `dark`, `tokens`.
2. **Colour check** — `node scripts/theme-check.js <path>` (add `--partial` for a
   user theme): missing or unknown tokens, bad colours, low contrast, and the CSS
   **budget**. The budget rejects `animation`/`transition`/`filter`/`backdrop-filter`
   and every layout-changing property (`padding`, `font-size`, `width`, …) — those
   belong to a structural token, not the CSS. `--partial` downgrades them to warnings.
3. **Look** — `npm run theme:preview -- <id> [out.png] [--eval "<expr>"]` renders a
   PNG to your temp folder and prints the path; read the image. The `--eval` arg
   prints a value from the running window (e.g. a computed border-radius).
4. **Ship** — put the files in `src/renderer/themes/`, run `npm run theme:docs` and
   `npm test`, add a `CHANGELOG.md` `[Unreleased]` bullet, and regenerate
   `docs/screenshot.png` only if the default theme changed.

## Rules

- A **bundled** theme defines **every** manifest token; a **user** theme may be
  partial, but omitted tokens fall back to the **light** defaults — a partial dark
  theme must therefore set its backgrounds and text.
- Beyond tokens, use the theme CSS. Depend only on the **stable hooks** listed in
  `docs/THEMES.md` (`:root`, `.module*`, `.slot`, `.swatch`, `.rng`, `.btn`, …), or
  an app update will break the theme. Never use CSS to load a remote resource — the
  CSP forbids it by design (the app works offline and does not phone home).
- **A theme's CSS may only paint.** It must not animate, filter, or change layout —
  the budget rejects those. To change text size, spacing or the font, set the
  **structural tokens** `--font-size`, `--space`, `--font-ui`, `--mono` in the JSON:
  they are geometry, so the app re-measures and re-clamps the window when they move
  (`kind: 'structural'` in the manifest). Colour, `--shadow` and `--radius` are paint
  and never resize anything.
- Fonts: name the bundled **Inter** / **DejaVu Sans** through `--font-ui` / `--mono`,
  or ship your own in `<themesDir>/<id>/` and reference `theme://<id>/<file>`.
- Never invent a token without the manifest, a `style.css` use and the doc agreeing
  — the test enforces it.

## Reference

The Blender palette (`userdef_default_theme.c`) and the stable hooks are recorded in
`docs/THEMES.md`; `blender-dark.json` + `blender-dark.css` are the worked example of
a full theme.