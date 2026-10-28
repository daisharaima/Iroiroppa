# Install

## Download

Open the [Releases page](https://github.com/daisharaima/Iroiroppa/releases) and choose one file:

| File | Use it when |
| --- | --- |
| `Iroiroppa.Setup.<version>.exe` | You want a normal installation and a Start menu entry. |
| `Iroiroppa-Portable-<version>.exe` | You want one self-contained file. |

Download only from the Releases page.

## Install

1. Double-click the downloaded file.
2. If Windows shows “Windows protected your PC”, choose **More info → Run anyway**. The app is unsigned.
3. Follow the installer. It closes a running copy of Iroiroppa before replacing files.
4. Iroiroppa opens with the default palette. If Clip Studio Paint is showing its QR code, it connects automatically.

## Settings location

| Build | Data folder |
| --- | --- |
| Installed | `%APPDATA%\Iroiroppa` |
| Portable | `Iroiroppa Data` beside the `.exe` |

The portable build keeps its settings, connection, layout and history in that folder. The installed and portable builds use separate folders.

## Updates

**Settings → General** shows an update when one is available. **(About → Check for updates also reports it.)**

- **Quit & install** (installer): downloads the setup, starts it and closes Iroiroppa.
- **Replace & relaunch** (portable): downloads the new `.exe`, waits for Iroiroppa to exit, replaces the exe and starts it.
- The release-page link is available for a manual download.

Nothing is downloaded until you press the button. **Auto**, next to **Check for updates**, checks GitHub at startup and once a day; turn it off to check only on demand.

## First launch

The default palette contains **Session**, **CSP Color**, **Color Wheel**, **Color Slices**, **Color Slider**, **Color History** and **Color Stat**. The first time a version runs, a **What's new** window shows its release note. Close it to use the palette; **Settings → About → What's new** reopens it.

## Remove

See [Reset, uninstall and back up](Reset-uninstall-and-backup.md).
