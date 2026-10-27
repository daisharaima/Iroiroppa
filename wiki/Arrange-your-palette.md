# Arrange your palette

Everything in the window is a **module**: a small panel that does one job. You can move them, resize them, hide them, duplicate them and pop them out. Nothing here can break your drawing — the worst case is a layout you do not like, and even that is easy to undo.

## Moving and resizing

- **Move a module:** drag its title bar (the strip with its name).
- **Resize a module:** drag the bottom edge of the module. Everything above and below adjusts to fit.
- **Change a module's own size numerically:** **Settings ▸ Modules ▸ Module size**.

There are no gaps and no fixed grid. A module alone in a column always fills it; when several share a column they split the space.

## The module menu

Click the **⋯** on a module's title bar for that module's own options — things like which colour model it shows, how thick its sliders are, whether it draws its guide lines. The exact list depends on the module; see [Colour pickers](Colour-pickers).

## Popping a module out

Drag a module's title bar **off** the palette and drop it on the desktop. It becomes its own small window you can park anywhere — handy for a big color wheel on a second monitor, or for keeping the history near your canvas.

Drag it back onto the palette to put it back. A window that has been emptied closes itself.

If a popped-out module ends up somewhere you cannot see it (an unplugged monitor, a changed screen size), use **Bring floats back on screen** in the tray menu.

## The palette menu

Click the **☰** at the left of the palette's title bar:

| Item | What it does |
| --- | --- |
| **Rename…** | Gives this palette a name, useful once you have more than one. |
| **Lock layout** | Freezes the arrangement and the window sizes so a stray drag cannot move anything. Click again to unlock. |
| **Settings…** | Opens the Settings window. |
| **Delete palette…** | Removes this palette. Asks you to click twice. |

**Unsnap** appears in the same menu when two palettes have snapped together.

## Snapping two palettes together

If you drag one palette's edge against another's, they snap flush, and moving or resizing the shared edge moves the pair together. Use **Unsnap** when you want them independent again.

## More than one palette

**Settings ▸ Layout** lists your palettes and, next to each one:

- **⧉ Duplicate** — makes a second window with the same modules. Each copy keeps its own module settings, so you can run one panel in OKLCH and another in CMYK.
- **⤓ Export** — writes that palette to a file, so you can share it or keep it.
- **✕ Delete** — removes it (click twice to confirm).

**Import…** at the top of that tab loads a palette file back in.

## Showing and hiding modules

**Settings ▸ Modules** is the honest list of everything available. Each module shows whether it is mounted, lets you add another copy of it, hide one you do not need, and set its size. Hiding a module is better than deleting your settings — hidden modules keep their options.

There is also **Remove unused settings files**, which cleans up leftover files for module instances that no longer exist.

## Saving a whole arrangement

**Settings ▸ Layout** has two useful things:

- **Save** a named workspace — your whole arrangement under a name you choose.
- **Export… / Import…** the entire workspace as one file, including the old *layout* file from an earlier version.

This is also how you undo an experiment: export before you rearrange, import if you dislike the result.

---

A module will not stay where you put it? Check that **Lock layout** is off in the palette menu, and see [Troubleshooting](Troubleshooting).
