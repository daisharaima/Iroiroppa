# Reset, uninstall and back up

Everything Iroiroppa remembers lives in one folder. That makes backing up, resetting and removing it simple — and it means uninstalling the program does not automatically throw your setup away.

## Where your data lives

| Build | Folder |
| --- | --- |
| Installed | `%APPDATA%\Iroiroppa` |
| Portable | `Iroiroppa Data`, right beside the `.exe` |

To open the installed one: press **Win+R**, type `%APPDATA%\Iroiroppa`, press Enter.

Inside it:

| File or folder | What it is |
| --- | --- |
| `settings.json` | All your switches and preferences. |
| `session.json` | Your saved pairing with Clip Studio Paint. Keep this private — it is how the connection is remembered. |
| `layout.json` | The arrangement: palettes, modules, sizes, positions. |
| `modules/` | Settings for each individual module instance. |
| `workspaces/` | Named layouts you saved. |
| `themes/` | Optional — theme files you added yourself. |

## Backing up

**Settings ▸ General ▸ Settings file ▸ Export…** writes your preferences to a file you choose. That is the easy backup, and the way to copy your setup to another PC: export there, **Import…** here.

**Settings ▸ Layout ▸ Export…** does the same for the arrangement. Worth exporting before you rearrange anything you like.

For a complete backup, including your colour history and your pairing, copy the whole data folder while Iroiroppa is closed.

## Resetting the arrangement only

Your layout is the thing most likely to end up somewhere odd. In order of severity:

1. **Settings ▸ Layout** — import a workspace or palette file you exported earlier.
2. **Settings ▸ Appearance** — the layout is not there; do not look for it. Use **Layout**.
3. Delete the palette with **Delete palette…** in its ☰ menu and let a fresh one be created.
4. With Iroiroppa **closed**, delete `layout.json` in the data folder. The next launch builds the default palette again.

Your settings, history and pairing survive all four.

## Resetting everything

1. **Quit** Iroiroppa from the tray menu. (Closing the window is not enough.)
2. Open the data folder from the table above.
3. Rename it to something like `Iroiroppa-backup` rather than deleting it, so you can change your mind.
4. Start Iroiroppa and pair again.

Renaming is better than deleting: everything is still there if you want it back.

## Forgetting just the connection

Tray menu → **Forget pairing**, or **Settings ▸ General ▸ Forget**. Your layout, settings and history stay. Do this if Clip Studio Paint has changed or connecting keeps failing; then pair again with a fresh QR code.

## Uninstalling

**Installed build:**

1. Quit Iroiroppa from the tray.
2. **Settings ▸ Apps ▸ Installed apps**, find Iroiroppa, **Uninstall**.
3. Decide about the data folder: leave `%APPDATA%\Iroiroppa` if you might return, delete it for a clean removal.

**Portable build:**

1. Quit Iroiroppa from the tray.
2. Delete the `.exe` and the `Iroiroppa Data` folder beside it.

There is nothing else installed: no service, no driver, no files inside Clip Studio Paint, no registry keys beyond the uninstall entry for the installed build.

## A completely clean slate

Uninstall, then confirm all three are gone:

- the program (Start menu entry, and the exe where you put it);
- `%APPDATA%\Iroiroppa` (or `Iroiroppa Data` for a portable copy);
- no Iroiroppa icon in the tray.

Then reinstall and start from [Install](Install).

---

Trouble during removal, or a leftover that keeps coming back? See [FAQ and getting help](FAQ-and-getting-help).
