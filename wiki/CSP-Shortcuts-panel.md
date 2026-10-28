# CSP Shortcuts panel

The CSP Shortcuts module searches and runs Clip Studio Paint's commands and tools. It is optional.

## Search and run

Type in **Search shortcuts…** to filter. Use the **All**, **Command** and **Tool** filters. Click a row to run it.

Where Clip Studio Paint already has a shortcut, the panel can send those keys. Commands are sent over the connection.

The list is read from Clip Studio Paint's **current workspace** (`workspace_*.spws`), not a merged factory list. Press **↻** after saving the workspace or closing Clip Studio Paint to re-read it.

## If the list is empty

Check the data folder first. It must contain the `CLIPStudioPaintVer…` folder, normally under `Documents\CELSYS`.

To set it:

1. Click **Locate CSP data folder…** in the module.
2. Or choose **Settings → General → Clip Studio Paint's settings folder → Browse…**. **Auto** restores the default.

If the folder is correct, save the workspace in Clip Studio Paint (or close it) and press **↻**.

## Bind a key

Open the module's **⋯** menu and assign a key to a command. If the key is already taken, the binding is not saved.

The show/hide, hold and after-pick keys are in **Settings → Shortcuts**; see [The tray icon and shortcuts](Tray-and-hotkey.md).

## Commands that do nothing

Sending keys requires Clip Studio Paint to be in front and ready for input. Click the canvas, then run the command again.
