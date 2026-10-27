# Connect to Clip Studio Paint

Iroiroppa talks to Clip Studio Paint the same way the official phone app does. You do not install anything into Clip Studio Paint; you show it a QR code once.

![The Iroiroppa palette; the Session row at the top is where the connection state appears](images/palette.png)

## The first time

1. Open Clip Studio Paint and open a document.
2. In Clip Studio Paint choose **File ▸ Connect to smartphone**. A window with a QR code appears.

   > In a translated Clip Studio Paint the menu items are translated too. Look at the bottom of the **File** menu for the item that mentions a smartphone or a QR code.

3. Leave that QR code on screen. Iroiroppa is already looking for it.
4. Within a second or two the **Session** row at the top of the palette should switch from **Scanning…** to its connected state, and Clip Studio Paint will say a phone is connected.

That is the whole setup. There is nothing to type, no IP address, no port.

## Afterwards

Iroiroppa remembers the connection. Next time you open Clip Studio Paint, it reconnects on its own — you normally never see the QR step again.

If it is not connected, one of these gets it going:

- Click the **Session** row, or use **Settings ▸ General ▸ Connect**.
- Right-click the tray icon near the clock and choose **Reconnect**, or **Connect (scan QR)...** to make it look for a fresh QR code.
- In Clip Studio Paint, reopen **File ▸ Connect to smartphone** and leave the QR on screen.

## If scanning will not work

Some screen setups and some remote-desktop sessions stop Iroiroppa from reading the QR. As a fallback, **Settings ▸ General** has a box that says **or paste QR URL / hex payload**. Paste the connection text there and click **Use**.

## Only one controller at a time

Clip Studio Paint allows one phone-side connection. If the official phone app is connected, or another copy of Iroiroppa, close it first — otherwise the new one cannot get in.

## Disconnecting

- **Disconnect** drops the connection but keeps the remembered pairing, so it comes back on its own.
- **Forget pairing** throws the pairing away. Use this if Clip Studio Paint changed, you moved to a different PC, or connecting keeps failing.

Both live in the tray menu, and in **Settings ▸ General**.

## What the connection states mean

| You see | What is happening |
| --- | --- |
| **Disconnected** | Not connected, and not trying. |
| **Scanning…** | Looking at the screen for a QR code. |
| **Connecting…** | Found it, opening the connection. |
| **Reconnecting…** | A remembered connection dropped and is being retried. |
| **Pairing failed** | The code was read but rejected. Reopen the QR code in Clip Studio Paint; if it keeps failing, use **Forget pairing** and pair again. |

## Does it look at my screen?

Only to find the QR code while it is scanning, and only locally — nothing is uploaded and the image is not saved. When **Connect automatically** is on (it is by default), Iroiroppa watches for that QR code while it is not connected. Turn it off in **Settings ▸ General** if you would rather it never looked.

---

Still stuck? See [Troubleshooting](Troubleshooting), the "It will not connect" rows.
