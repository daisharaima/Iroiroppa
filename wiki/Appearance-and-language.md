# Appearance and language

All of this lives under **Settings ▸ Appearance**. None of it changes how colours are picked — it changes how the tool feels.

## Theme

A list of the themes that came with Iroiroppa: a light one, a dark one, and variants. Pick one and the palette repaints immediately.

Themes only change paint — colours, corner rounding, shadows — never the size or position of anything, so switching never breaks your arrangement.

If you add your own theme files to the `themes` folder in Iroiroppa's data folder, they appear in this list too.

## Accent colour

The small swatch next to **Accent colour**. Click it for a colour chooser with a hue slider and a hex field, and **Save** when you like it. The accent shows up on active controls and highlights.

The reset button beside it puts the theme's own accent back.

Your choice of accent is remembered per theme, so a dark theme and a light theme can each have their own.

## UI scale

Slides the whole interface between **80%** and **160%**. The arrows step by 1%; the reset button returns to **100%**.

This is the answer for a very large or very small monitor: at 100% on a 4K screen the palette can be tiny, and at 150% on a small laptop it can be comfortable. The window grows with the scale, and it remembers the size relative to the scale, so changing the scale later does not compound.

## Language

**Match the system** follows your Windows language, and Iroiroppa ships in **28 languages** — English, Arabic, Czech, Danish, German, Spanish, Finnish, French, Hebrew, Hungarian, Indonesian, Italian, Japanese, Korean, Norwegian, Dutch, Polish, Brazilian Portuguese, Romanian, Russian, Swedish, Thai, Turkish, Ukrainian, Vietnamese, Simplified Chinese and Traditional Chinese.

Change it and the whole interface, including the Settings window, follows.

## The rest of the tab

| Setting | Default | What it does |
| --- | --- | --- |
| Show crosshair guides | on | Draws the crosshair and guide lines over the colour maps. Turn off for a cleaner look. |
| Color model family | All | Narrows every model list — in every picker — to **OKLab**, **CIELAB** or **HelmGen**. Useful if the full list is too long. |
| Hide module names | off | Keeps each module's title bar for dragging, but hides its name. |

**Color model family** is worth knowing about: the underlying colour is the same in every family, so this only tidies the menus. If you are learning OKLCH, leave it on **All** until the other names stop being interesting.

---

Nothing visibly changed? See [Troubleshooting](Troubleshooting).
