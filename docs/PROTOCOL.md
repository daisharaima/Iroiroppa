# Companion Mode protocol notes

How Iroiroppa talks to Clip Studio Paint. This is an **observational** record
of an undocumented, reverse-engineered protocol — treat it as field notes, not a
specification, and expect it to change when CSP changes.

Credits: the wire format, command set and authentication crypto were
reverse-engineered by [chocolatkey/clipremote](https://github.com/chocolatkey/clipremote)
(MIT), whose implementation this project follows. Behavioural details (the idle
gate, partial payloads, lock-screen reconnection) are also documented in
[LumaPaletteCSP's `PROTOCOL.md`](https://github.com/andyubird/LumaPaletteCSP/blob/main/PROTOCOL.md).
Tested against **CSP 5.0.4** on Windows.

## Discovery: the QR code

CSP shows a QR under *File ▸ Connect to smartphone* encoding a URL like
`https://companion.clip-studio.com/rc/<lang>?s=<hex>`. The `s` parameter is the
connection config, XOR-obfuscated with a 7-byte repeating key and hex-encoded:

```
plaintext = <ip>[,<ip>...] \t <port> \t <password> \t <generation>
key       = 74 B2 92 5B 4A 21 DA          (REMOTE_KEY)
```

`<generation>` is a spec tag echoed in `Authenticate` (observed `G#1:2022.12`).
The desktop listens on an ephemeral TCP port that changes each time the
companion window is opened.

**Capture strategy.** A scan first finds the Companion dialog window itself — a
long-lived PowerShell helper (Win32 `EnumWindows` + `GetWindowRect`,
`capture.js#captureCompanionWindow`) — and reads its rectangle straight off the
screen (`CopyFromScreen`). The dialog is found **by process, not by title**: any small
window belonging to the CSP/Udongman process is a candidate (the QR itself is then
validated), which is language-independent — CSP ships in 11 languages and the Chinese
build runs as *Udongman Paint*. A title match is a secondary signal only, and the
titles differ per language (EN *Connect to smartphone*, JA スマートフォンを接続, KO
스마트폰 접속, ZH-TW 連接智慧型手機, ZH-CN 连接智能手机, FR *Connecter au smartphone*,
DE *Mit Smartphone verbinden*, ES *Conectar a smartphone*, PT-BR *Conectar ao
smartphone*, ID *Hubungkan ke smartphone*, …). This is both reliable (the QR is a
small window, never a sliver of a 2560x1600 screen) and fast: after a one-off
Add-Type compile the helper answers in ~80 ms, so the QR is caught almost the moment
the dialog opens. `desktopCapturer` window enumeration was tried first and rejected —
it captures every window (~3.5 s on a busy desktop, whatever the thumbnail size) —
and spawning PowerShell per scan (~2 s) was rejected too. When no candidate window is
found the scan falls back to the whole desktop (capped at **1280x800** per display,
the cursor's display first), but only every third pass, so polling stays cheap; at
1280x800 a desktop pass is ~1 s and jsQR still reads a Companion QR down to ~60 px.
Auto-connect takes its first scan ~0.1 s after disconnect and then polls about every
0.15 s; the palette is parked off the QR only if the unparked first scan misses.

## Framing

```
<type> $tcp_remote_command_protocol_version=1.0 \x1e$
command=<NAME> \x1e$ serial=<N> \x1e$ detail=<JSON> \x1e \x00
```

- `0x1e` (`\x1e`) is the record separator and is always followed by `$`.
- `0x00` terminates the frame. JSON escapes control bytes, so it is safe as a
  terminator, and multiple frames may arrive in one TCP read — buffer and split.
- Packet types: `0x01` client command, `0x06` success, `0x15` error. CSP's own
  handlers key success on the reply *detail* (e.g. `AuthErrorReason`), not the
  type byte, so inspect the body.
- A detail may be `<json>\x0b<base64 binary>` (used by the preview commands).

## Authentication

`Authenticate` carries a 3-element array:

```
[generation, hex(xor(password, AUTH_KEY)), hex(xor(newPassword, AUTH_KEY))]
AUTH_KEY = B6 D5 92 C4 A7 83 E1
```

On success the host stores `newPassword`, which becomes the session password for
reconnects. Reconnecting on a fresh socket sends the literal marker
`{{(([[reconnection request marker]]))}}\r\n` as the current token and the
**same** stored password as the new token; randomising it yields
`PasswordMismatch`.

## The idle gate

A `TellHeartbeat` with an empty body marks the client idle, and the host then
answers every `Sync*` poll with `{}`. Send `{"IdleTimerResetRequested":true}` on a
heartbeat to become active again and the host resumes feeding full `Sync*` state.
The phone app does this the moment the user touches its UI.

The flag cuts both ways: it resets the host's idle timer, which is the **same**
timer CSP uses to pause a document's worktime tracker. A client that resets it
forever — as sending it once a second does — makes that tracker count nonstop.
Iroiroppa therefore resets it only while its palette is on screen, **CSP is the
foreground app**, and the machine has seen recent input, and otherwise sends empty heartbeats (which still
keep the TCP connection alive) so CSP pauses on its own schedule. The decision
lives in `CompanionService#_mayKeepHostAwake`; see `docs/INVARIANTS.md`.

*Untested:* how long the host keeps a passively-idle session alive. The official
app sends empty heartbeats while idle and stays connected, so an indefinite
keep-alive is expected — but a live check (step away for a few minutes, then
confirm the status is still `connected` and reads resume on the next input) is
the way to be sure.

## Reading the colour

`SyncColorCircleUIState` is the read API. The request is a poll; the response
carries the full colour state:

```json
{ "ColorSelectionModel": "HSV", "CurrentColorIndex": 0,
  "HSVColorMainH": 25195178, "HSVColorMainS": 2931453695, "HSVColorMainV": 4118002943,
  "HSVColorSubH": 0, "HSVColorSubS": 0, "HSVColorSubV": 4294967295,
  "IsCurrentColorTransparent": false, "CurrentToolAlphaPercent": 100 }
```

Channels are `uint32` scaled over `0..4294967295`; H maps to `0..360°`, S/V to
`0..100%`. `CurrentColorIndex` is `0` main/foreground, `1` sub/background.

The host can return a **partial** payload that omits fields if nothing changed,
so merge results into the last known state rather than trusting every reply to
be complete. Sending a deliberately *stale* request detail coaxes a fuller reply.

## Writing the colour

`SetCurrentColor` has three variants, distinguished by which fields are present:

- **RGB** — `{IsColorTransparent, RGBColorR, RGBColorG, RGBColorB}` (0–255).
  Must **not** carry `ColorSpaceKind`; the host detects RGB by its absence. Writes
  whichever slot is currently active.
- **HSV** — adds `ColorSpaceKind:"HSV"`, `ColorIndex`, `HSVColorH/S/V` (uint32).
  Writing a slot's own values back with its `ColorIndex` also **activates** that
  slot, which is how the slot chips work.
- **HLS** — as HSV with `HLSColor*`.

To select the transparent (eraser) colour, send the RGB variant with
`IsColorTransparent: true`.

## Practical consequences

- Only **one controller** may be connected at a time; a second TCP connection is
  refused. Quit the app before running the CLI probe.
- Read-back can lag a write by a few hundred milliseconds. Iroiroppa keeps the
  written value "sticky" for a moment so its own read-back cannot revert the UI.
- Changes made on the desktop are only seen by **polling**
  (`SyncColorCircleUIState`), not by host pushes, which is why the app polls
  adaptively (fast after any change, slower when idle).
- The protocol carries only raw channel values — **no colour space travels with
  them**. They are meaningful in the document's **embedded profile**, so for an
  Adobe RGB document they are Adobe RGB, not sRGB. *Colour profile ▸ Preview* is
  only a display simulation and does not change them. See `COLOR.md`.

## Protocol essentials

Full notes in `docs/PROTOCOL.md`. The essentials:

- Frames: `<type>$tcp_remote_command_protocol_version=1.0\x1e$command=<name>\x1e$serial=<n>\x1e$detail=<json>\x1e\x00`.
  Types `0x01` command, `0x06` success, `0x15` error. Records can be coalesced.
- Two independent 7-byte repeating-XOR keys: `REMOTE_KEY` for the QR `s`
  parameter and `AUTH_KEY` for auth tokens (`crypto.js`).
- QR payload is `ips\tport\tpassword\tgeneration`.
- **Idle gate:** a `TellHeartbeat` carrying `{"IdleTimerResetRequested":true}`
  makes the host feed full `Sync*` state; an empty one marks us idle and every
  `Sync*` answers `{}`. Reset it only while the user is working, or CSP's
  worktime tracker never pauses.
- **One controller at a time** — a second connection is refused. Close the app
  before running `npm run probe`.
- `SyncColorCircleUIState` may return a **partial** payload (some fields absent).
  The active slot is authoritative. A poll whose response arrives after a host
  push is stale and must be discarded; never let it overwrite the push. A poll that
  reverts to the colour we just changed away from is read-back lag until it
  persists for two consecutive polls. An inactive-slot-only partial update is UI state, not a colour
  pick.
- Colour changes made *inside* CSP are only picked up by **polling**
  (`SyncColorCircleUIState`), not by pushes.



## Session storage

`session.json` holds the Companion pairing (host, port, password). With
`--secret-store` the password is encrypted at rest with Electron's `safeStorage`
(Windows DPAPI, tied to the user account), and the file becomes
`{ __secret: true, v: 2, data, secrets }`. A plaintext file is read as-is and
upgraded on the next write, and the consumer API is unchanged — the store always
hands back plaintext. A secret that cannot be decrypted (another user/machine, or a
corrupt blob) is dropped so the app can simply re-pair. Never commit `session.json`.
See docs/STATE.md.
