# The tray icon and the hotkey

This is the page to read the first time the palette seems to disappear. It is almost certainly still running.

## Why it hides

**Auto-hide** is on by default. Iroiroppa shows itself while Clip Studio Paint is the program in front, and hides when you switch to something else — your browser, Explorer, another window. That is deliberate: a colour picker floating over your email is not useful, and it should never sit in the way.

So the palette "vanishing" usually means: you clicked another window.

## Getting it back

Three ways, in order of convenience:

1. **Click back into Clip Studio Paint.** The palette returns by itself.
2. **Use the tray icon** — the small Iroiroppa icon near the clock, bottom-right of the screen. It may be tucked under the **^** arrow. Right-click it for the menu, or double-click to show and hide the palette.
3. **Use the summon hotkey**, if you have set one (below).

## The tray menu

| Item | What it does |
| --- | --- |
| **Show / hide palette** | The same as double-clicking the icon. |
| **Bring floats back on screen** | If a module was popped out into its own window and left on a monitor you unplugged, this brings it back. |
| **Settings…** | Opens the Settings window. |
| **Reconnect** | Retries the remembered connection. |
| **Connect (scan QR)...** | Shows the palette and looks for a fresh QR code. |
| **Disconnect** | Drops the connection, keeping the pairing. |
| **Forget pairing** | Throws the pairing away. |
| **Quit** | Closes Iroiroppa completely. |

## Turning auto-hide off

If you would rather the palette stayed put while you work in other windows:

**Settings ▸ General ▸ Auto-hide** — switch it off.

Now Iroiroppa stays visible until you hide it yourself. It still will not steal focus from your other programs.

## Setting a summon hotkey

Out of the box there is **no hotkey**. If you want one:

1. Open **Settings ▸ General**.
2. Click the **Summon hotkey** box.
3. Press the key combination you want. It must include at least one modifier — Ctrl, Alt or Shift — so it cannot swallow ordinary typing.
4. Press **Esc** to clear it again.

Now that combination shows and hides the palette from anywhere, even while Clip Studio Paint has focus.

> If Windows says the key is unavailable, another program already owns it. Pick a different combination.

## Starting with Windows

**Settings ▸ General ▸ Start when Windows starts** launches Iroiroppa when you sign in, so it is already there when you open Clip Studio Paint.

## Quitting properly

Closing the palette window is not the same as quitting. Use **Quit** in the tray menu, or **Settings ▸ Quit**. Otherwise it keeps running — which is usually what you want, since it will reconnect for you next time.

---

Palette not coming back at all? See [Troubleshooting](Troubleshooting).
