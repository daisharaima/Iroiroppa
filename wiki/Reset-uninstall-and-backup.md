# Reset, uninstall and back up

## Data folder

| Build | Folder |
| --- | --- |
| Installed | `%APPDATA%\Iroiroppa` |
| Portable | `Iroiroppa Data` beside the `.exe` |

| Item | Contents |
| --- | --- |
| `settings.json` | Preferences. |
| `history.json` | Color History. |
| `session.json` | Pairing with Clip Studio Paint. Keep private. |
| `layout.json` | Palettes, modules, sizes and positions. |
| `modules/` | Per-instance module settings. |
| `workspaces/` | Saved layouts. |
| `themes/` | Custom themes. |

Open the installed folder with **Win+R** and `%APPDATA%\Iroiroppa`.

## Back up

- **Settings → General → Settings file → Export…** saves preferences.
- **Settings → Layout → Export…** saves the arrangement.
- For a complete backup, close Iroiroppa and copy the whole data folder.

## Reset the layout

1. Import an exported workspace or palette from **Settings → Layout**.
2. Or delete the palette from its **☰** menu; a fresh one is created.
3. With Iroiroppa closed, delete `layout.json` to restore the default palette.

Settings, history and pairing are not affected.

## Reset everything

1. Quit Iroiroppa from the tray.
2. Rename the data folder, for example to `Iroiroppa-backup`.
3. Start Iroiroppa and pair again.

## Forget the connection

Use **Forget pairing** in the tray or **Settings → General**. Layout, settings and history are kept.

## Uninstall

**Installed:** quit Iroiroppa, then open **Settings → Apps → Installed apps**, select Iroiroppa and choose **Uninstall**. Delete `%APPDATA%\Iroiroppa` for a clean removal.

**Portable:** quit Iroiroppa, then delete the `.exe` and the `Iroiroppa Data` folder.

There is no service, driver or file inside Clip Studio Paint. The only optional registry entry is **Start when Windows starts**.
