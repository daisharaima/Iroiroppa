# Troubleshooting

## Install and start

| Symptom | Fix |
| --- | --- |
| “Windows protected your PC” | **More info → Run anyway**. The app is unsigned. |
| Antivirus quarantines it | Allow the Iroiroppa `.exe`. Screen reading can look suspicious. |
| Nothing appears after launch | Check the tray icon, including the **^** overflow. |
| Two copies behave differently | Installed and portable copies keep separate data. Quit one. |
| “Check for updates” fails | Check the network or GitHub access. Download from the [Releases page](https://github.com/daisharaima/Iroiroppa/releases). |

## Connect

| Symptom | Fix |
| --- | --- |
| No reaction to the QR code | Keep the whole code visible. Click the **Session** dot, or use the tray's **Connect (scan QR)...**. |
| Stuck on **Scanning…** | Resize or uncover the QR window. Or paste the QR URL in **Settings → General** and click **Use**. |
| **Pairing failed** | Open a fresh QR code, use **Forget pairing**, then connect again. |
| Stuck on **Reconnecting…** | Open a fresh QR code in Clip Studio Paint. |
| The phone app was connected | Close it. Only one controller can connect. |
| It worked yesterday | Update or re-pair. Companion Mode can change with Clip Studio Paint. |
| Remote desktop cannot scan | Use the QR URL box in **Settings → General**. |

## Palette and shortcuts

| Symptom | Fix |
| --- | --- |
| Palette disappeared | Auto-hide. Click into Clip Studio Paint or use the tray. |
| Palette will not hide | Turn off **Settings → General → Auto-hide**. |
| Drags feel slow | Turn off **Live sync while dragging**, or reduce **UI scale**. |
| Module is missing | **Settings → Modules** shows hidden and mounted modules. |
| Module will not stay put | Turn off **Lock layout** in the palette's **☰** menu. |
| Popped-out module is lost | Tray → **Bring floats back on screen**. |
| A palette is gone | Check **Settings → Layout**, or import an exported workspace. |
| Shortcut does not register | Another program owns it. Choose another key. |
| Single key types instead of acting | Single keys are ignored in text fields, dialogs and search boxes. Click the canvas first. |
| Dropdown is behind Settings | Use the current build; this is fixed. |

## Colors

| Symptom | Fix |
| --- | --- |
| HEX differs from Clip Studio Paint's | Rounding, or comparing the document HEX with a display-space value. See [Color profiles and gamut](Color-profiles-and-gamut.md). |
| Colors look washed out | Set the document profile in the **Session** dropdown. |
| Color shifts when sent | It was outside the document gamut and was snapped to the nearest valid color. |
| Pale or dimmed map region | A pale region is the out-of-document stand-in. A dimmed region means **Mark colors this display can't show** is on. |
| OKHSV/OKHSL cannot reach a color | Use an RGB document profile, or switch to OKLCH or HelmGen. |

## Panels

| Symptom | Fix |
| --- | --- |
| CSP Shortcuts is empty | Set the data folder, save the workspace or close Clip Studio Paint, then press **↻**. |
| A CSP command does nothing | Click the Clip Studio Paint canvas first, then run the command. |
| Color History is empty | It fills as you pick. |
| Color Stat shows no numbers | Connect to Clip Studio Paint first. |
