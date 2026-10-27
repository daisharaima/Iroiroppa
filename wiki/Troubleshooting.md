# Troubleshooting

Find the symptom, try the fix. Most of these are one switch somewhere.

## Installing and starting

| Symptom | Fix |
| --- | --- |
| Windows says "Windows protected your PC" | Click **More info → Run anyway**. The program is unsigned; see [Install](Install). |
| Antivirus quarantines it | Add an exception for the Iroiroppa exe. A free unsigned program that reads the screen for a QR code looks suspicious to scanners. |
| I started it and see nothing | It is probably hiding. Look for the tray icon near the clock (it may be under **^**), and see [The tray icon and the hotkey](Tray-and-hotkey). |
| Two Iroiroppas, confusing each other | An installed copy and a portable copy keep separate data, so both can run. Quit one — **Quit** in the tray menu. |
| It opens behind Clip Studio Paint | Usually Auto-hide catching up. Click the palette in the taskbar tray, then click into Clip Studio Paint. |
| "Check for updates" fails | No internet, or GitHub is blocked on your network. Update by downloading from the [Releases page](https://github.com/daisharaima/Iroiroppa/releases). |

## Connecting

| Symptom | Fix |
| --- | --- |
| Nothing happens when Clip Studio Paint shows the QR | Make sure the QR is fully visible and not covered by another window. Click the **Session** row, or use the tray's **Connect (scan QR)...**. |
| It stays on **Scanning…** | The QR is not being read. Move or resize the Clip Studio Paint window so the whole code shows, or paste the QR URL into **Settings ▸ General** and click **Use**. |
| It says **Pairing failed** | Reopen **File ▸ Connect to smartphone** in Clip Studio Paint so a fresh code appears, then use **Forget** and try again. |
| It says **Reconnecting…** and never connects | It retries a few times by itself and then gives up so it can scan again. Reopen the QR code in Clip Studio Paint — that is the reliable fix. |
| The phone app was connected before | Clip Studio Paint allows one controller. Close the phone app (or unplug it), then reconnect. |
| It connects to the wrong Clip Studio Paint | Only one Clip Studio Paint can be paired at a time. Close the other one, use **Forget pairing**, and pair again. |
| It worked yesterday, not today | Clip Studio Paint may have updated. Reopen the QR code and pair again. Companion Mode is undocumented and changes between versions. |
| Remote desktop refuses to work | Screen reading can fail there. Use the **or paste QR URL / hex payload** box in **Settings ▸ General**. |

## Using it

| Symptom | Fix |
| --- | --- |
| The palette disappeared | That is Auto-hide. Click back into Clip Studio Paint, or use the tray icon. |
| It will not hide and is in the way | **Settings ▸ General ▸ Auto-hide** is on; turn it off, or drag the palette aside. |
| Drags feel laggy | Turn off **Live sync while dragging** so colours are sent on release. A large Color Wheel on a 4K screen is the heaviest panel; a smaller UI scale helps. |
| A module went missing | **Settings ▸ Modules** shows everything, including what is hidden. Click to show it again. |
| A module will not stay where I put it | Check **Lock layout** in the palette’s ☰ menu is off. If it is a palette edge, **Unsnap** first. |
| A popped-out module vanished | Tray menu → **Bring floats back on screen**. |
| A palette I built is gone | **Settings ▸ Layout** lists palettes; check whether it was deleted. An exported workspace or the old *layout* file can be imported back. |
| Shift does nothing | Shift affects the pickers while you **drag**. Hold it before the drag starts. |
| My hotkey will not register | Another program owns it. Try another combination, with Ctrl, Alt or Shift. |

## Colours

| Symptom | Fix |
| --- | --- |
| The hex code differs from Clip Studio Paint's | Rounding, or a non-sRGB document. Expected — see [Colour profiles and gamut](Colour-profiles-and-gamut). |
| Colours look washed out or pale | Your document is probably a wide-gamut one. Set its profile in the Session panel, so the pickers show the right colours. |
| A colour shifts slightly when I send it | It was outside what the document can hold and got snapped to the edge. That is deliberate; the stored colour is always a real colour of the document. |
| The map has a flat, faded patch | That region is outside what your monitor can show. Nothing is broken — see "Mark colours this display can't show". |
| The Colour Slider does not reach a colour my document has | The RGB-shaped models (OKHSV, OKHSL, OKHWB) are sRGB-based. Switch the module to OKLCH or a HelmGen model. |

## Panels

| Symptom | Fix |
| --- | --- |
| CSP Shortcuts is empty | Point it at Clip Studio Paint's settings folder — usually a moved or OneDrive Documents folder. See [CSP Shortcuts panel](CSP-Shortcuts-panel). |
| A command in CSP Shortcuts does nothing | Click the Clip Studio Paint canvas first so it can receive the key, then click the command again. |
| Color History is empty | It fills as you pick. "No colours yet" is normal on a fresh install. |
| Color Stat shows no numbers | It follows the connection; if the palette is disconnected there is no colour to describe. |

---

Nothing here matches? See [FAQ and getting help](FAQ-and-getting-help) for what to include in a report.
