# Settings

Open them from the **Session** panel, the palette's **☰** menu, the tray icon, or the **Settings…** item in a module's **⋯** menu. Settings live in their own window with four tabs.

![The Settings window](images/settings.png)

Nothing here is required. Iroiroppa works out of the box; these are the switches for making it fit the way you work.

## General

**Connection** — the state, a **Connect** button, **Reconnect**, **Forget**, and a box to paste a QR URL or hex payload if scanning cannot work. See [Connect to Clip Studio Paint](Connect-to-Clip-Studio-Paint).

**Behaviour**

| Setting | Default | What it does |
| --- | --- | --- |
| Live sync while dragging | on | Send colour changes while you drag. Off sends only when you let go. |
| Auto-hide | on | Show the palette while Clip Studio Paint is in front, hide it otherwise. See [The tray icon and the hotkey](Tray-and-hotkey). |
| Connect automatically | on | Watch for Clip Studio Paint's QR code while not connected. Only reads the QR, locally. |
| Start when Windows starts | off | Launch Iroiroppa when you sign in. |
| Summon hotkey | none | A key combination that shows and hides the palette. Needs a modifier; **Esc** clears it. |

**Proof Color**

| Setting | Default | What it does |
| --- | --- | --- |
| Colour profile | default sRGB | How to interpret your document's colours. See [Colour profiles and gamut](Colour-profiles-and-gamut). |
| Mark colours this display can't show | off | Dim the colours your monitor cannot display. |

**CSP data folder** — where Clip Studio Paint keeps its settings, for the [CSP Shortcuts panel](CSP-Shortcuts-panel). **Auto** uses the usual location.

**Settings file** — **Export…** writes your preferences to a file; **Import…** merges one back. This is the backup button, and the way to copy your setup to another PC.

**Module shortcuts** — optional keys for module commands. You will not need this to get started.

At the bottom: **Check for updates**, the version number, and **Quit**.

## Appearance

Where it all looks: theme, accent colour, UI scale, language, crosshair guides, hidden module names, and which colour model families the pickers list. All of it is described in [Appearance and language](Appearance-and-language).

## Modules

The complete list of modules, in three groups: **core** (Session, CSP Color), **picker** (Slices, Wheel, Slider, Disc) and **utility** (Stat, History, Shortcuts).

For each one you can:

- see whether it is **mounted** in the workspace;
- **show or hide** an instance with one click;
- **add** another instance, copied from the default;
- set its **Module size**;
- read a **Preview** of it before committing;
- delete an instance (click twice to confirm).

**Trash** and **Remove unused settings files** clean up leftovers from modules you have deleted. Nothing important is in there — it is old settings for panels that no longer exist.

A few modules are singletons: Session and CSP Color only ever exist once, because a second copy would say nothing new.

## Layout

Your **palettes** and your **workspaces**.

Each palette row has a name field and a count of its modules, then **⧉ duplicate**, **⤓ export** and **✕ delete**. Below each palette are its modules, so this tab is also the map of what is where.

Then **Save** a named workspace, and **Export… / Import…** the whole arrangement as one file — including a *layout* file saved by an older version.

See [Arrange your palette](Arrange-your-palette) for what these do in practice.

---

Something in here unclear or misbehaving? See [Troubleshooting](Troubleshooting).
