# 0004 — One native helper process, not a PowerShell per job

Status: accepted 2026-11-02. Implementation: `src/main/native/irohost.cs`,
`src/main/native-host.js`, `scripts/build-host.js`.

## Context

Three always-on jobs need Windows APIs a browser does not expose: keeping the
palette in the always-on-top band, watching the foreground app, and observing the
mouse to know when a pick ends over Clip Studio Paint. Each was a separate
PowerShell process that loaded a compiled helper from source with `Add-Type`.

Measured on Windows 11 build 26300: 841 ms for `powershell.exe -NoProfile` to
start and exit, 1,240–1,269 ms for a one-shot query, ~53 MB private per idle
helper, and one process per job — three at steady state, plus a fresh one every
few seconds wherever a safety timer asked the foreground question.

## Decision

One small compiled process owns all three jobs and speaks newline-delimited JSON
on stdin/stdout. It is built with the C# compiler that ships with Windows
(`scripts/build-host.js`, no SDK), shipped in the package as an unpacked file,
and supervised by the app: restart with backoff, and exit on stdin EOF so a crashed
app cannot leave a hook behind.

## Why

- **Startup is the cost, not the event.** 841 ms of a 1,269 ms one-shot is process
  creation; a warm command is 0.10 ms. The host starts in ~1 ms and answers in ~1 ms.
- **Footprint.** ~168 MB of a ~445 MB steady state was the three helpers; one host
  is 12–22 MB.
- **One writer per window.** The band repair is one line on a pipe, so the 100 ms
  watchdog costs nothing when the window is already correct.

## Rejected

- **Keep PowerShell and accept the footprint** — it keeps a spawn in the press path
  and does not survive application-control policies that block runtime-compiled DLLs.
- **Compile the host on first launch** — it produces exactly the unknown unsigned
  binary that Smart App Control blocks, and it is not a fallback when the shipped
  one fails.
- **Port the bare-key hook now** — its IME/caret/dialog checks are the riskiest
  surface in the app; it stays on PowerShell until it has its own review.

## Consequences

The binary must be built before packaging (`npm run pack` does it) and is not
committed. `--no-native-host` restores the PowerShell path for diagnosis, and a
missing binary falls back automatically.
