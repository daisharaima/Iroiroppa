# CSP Shortcuts panel

Clip Studio Paint has hundreds of commands and tool shortcuts. This panel lets you search them and run them without hunting through menus — and, if you like, give any of them a keyboard shortcut of your own.

It is optional. Everything else in Iroiroppa works with this panel hidden.

## Searching and running

Type in the **Search shortcuts…** box to filter. Each row is a command or a tool.

- Click a row to run it.
- Commands go to Clip Studio Paint over the connection.
- Where a command has a keyboard shortcut already, the panel can send the keys instead.

## If the list is empty

This is by far the most common problem with this panel, and it has nothing to do with the connection.

The list is read from **Clip Studio Paint's own settings folder**, normally:

```
Documents\CELSYS
```

That folder is the one containing the `CLIPStudioPaintVer…` folder. If your Documents folder has been moved — most often because OneDrive took it over — Clip Studio Paint writes its settings somewhere else, and Iroiroppa looks in the old place and finds nothing.

Two ways to fix it:

1. In the panel itself, click **Locate CSP data folder…** and pick the folder that contains the `CLIPStudioPaintVer…` folder.
2. Or open **Settings ▸ General ▸ Clip Studio Paint's settings folder**, click **Browse…**, and choose it. **Auto** puts it back to the default.

Choose the folder that *contains* the `CELSYS`/`CLIPStudioPaintVer…` entries, not the file inside it and not Clip Studio Paint's program folder.

## Giving a command your own shortcut

In the module's **⋯** menu you can bind a key to a command. The binding is global enough to be useful while you paint, so prefer combinations nothing else wants; if the key is already taken, the binding will not stick.

The **Summon hotkey** for the whole palette is set separately, in **Settings ▸ General**.

## When it cannot send keys

Running a command by sending keys needs the target window to be in front and able to receive typing. If a command seems to do nothing, click the Clip Studio Paint canvas first, then try again.

---

Wrong folder chosen, or nothing happens when you click a command? See [Troubleshooting](Troubleshooting).
