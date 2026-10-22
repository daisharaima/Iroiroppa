'use strict';

// Screen capture + QR decoding.
//
// Two capture backends:
//   - Electron's desktopCapturer (when running inside the app)
//   - a PowerShell + System.Drawing screenshot, for the standalone CLI probe
// Both yield raw RGBA frames that jsQR can read.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const jsQR = require('jsqr');

const ELECTRON_CAPTURE_TIMEOUT_MS = 8000;

/** Reject if `promise` does not settle in time, so a hung capture cannot stall a scan. */
function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref?.();
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Decode the first QR code in an RGBA frame.
 * @returns {string|null} the QR text, or null
 */
function decodeQrRgba(rgba, width, height) {
  if (!rgba || !width || !height) return null;
  const result = jsQR(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height, {
    inversionAttempts: 'attemptBoth',
  });
  return result ? result.data : null;
}

/** BGRA -> RGBA, in place on a copy. */
function bgraToRgba(buf) {
  const out = Buffer.from(buf);
  for (let i = 0; i + 3 < out.length; i += 4) {
    const b = out[i];
    out[i] = out[i + 2];
    out[i + 2] = b;
  }
  return out;
}

// A capture pass is on the auto-connect critical path, so the thumbnail is
// capped well below the desktop resolution: at 1280x800 a full-screen frame
// decodes in a fraction of the time of a 2560x1600 one, and a Companion QR is
// still comfortably above jsQR's module floor. The cursor's display is decoded
// first (see `captureWithElectron`), so the common case is one frame.
const CAPTURE_MAX = { width: 1280, height: 800 };

/** Capture with Electron's desktopCapturer. Returns [{width,height,rgba}]. */
async function captureWithElectron() {
  const { desktopCapturer, screen } = require('electron');
  const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: CAPTURE_MAX,
    fetchWindowIcons: false,
  });
  // Decode the display the cursor is on first: `scanOnce` stops at the first
  // frame that decodes, and that is almost always where the QR is.
  const cursorId = String(cursorDisplay.id);
  const ordered = [...sources].sort((a, b) => {
    const da = String(a.display_id || '') === cursorId ? 0 : 1;
    const db = String(b.display_id || '') === cursorId ? 0 : 1;
    return da - db;
  });
  const frames = [];
  for (const src of ordered) {
    const img = src.thumbnail;
    if (!img || img.isEmpty()) continue;
    const size = img.getSize();
    frames.push({ width: size.width, height: size.height, rgba: bgraToRgba(img.toBitmap()) });
  }
  return frames;
}

// The Companion dialog carries the QR, so reading *that window* is the reliable
// path. Neither built-in option polls cheaply: `desktopCapturer` window enumeration
// captures every window (~3.5 s on a busy desktop, whatever the thumbnail size), and
// spawning PowerShell per scan costs ~2 s of Add-Type compile. So one long-lived
// PowerShell helper compiles once and then answers "find the dialog" / "shoot this
// rect" in milliseconds — Win32 `EnumWindows` for the rects, `CopyFromScreen` for the
// pixels.
//
// The dialog is found **by process, not by title**: CSP ships in 11 languages (EN
// "Connect to smartphone", JA スマートフォンを接続, KO 스마트폰 접속, ZH-TW
// 連接智慧型手機, ZH-CN 连接智能手机, FR "Connecter au smartphone", DE "Mit
// Smartphone verbinden", ES "Conectar a smartphone", PT-BR "Conectar ao
// smartphone", ID "Hubungkan ke smartphone", …) and the Chinese build runs as
// "Udongman Paint". Any *small* window of the CSP/Udongman process is a candidate;
// the QR itself is validated by the caller's `accept`. A title match is kept as a
// secondary signal — mostly so a test can pose as the dialog — because the process
// check covers every language and every future rename.

/** A window title that names a Companion dialog, in any supported language. */
const COMPANION_TITLE = /smartphone|スマートフォン|スマホ|스마트폰|智慧型手機|智能手机|สมาร์ทโฟน|ponsel/i;

/** Does this window title look like a Companion dialog? (Secondary to the process match.) */
function isCompanionWindow(name) {
  return COMPANION_TITLE.test(String(name || ''));
}

const PS_HELPER = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -Namespace W -Name U -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
[DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@
[void][W.U]::SetProcessDPIAware()
function Find-Companion {
  $script:rects = New-Object System.Collections.ArrayList
  $script:csp = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'clipstudiopaint|udongman' } | ForEach-Object { [uint32]$_.Id })
  $cb = [W.U+EnumWindowsProc]{
    param($h, $l)
    if (-not [W.U]::IsWindowVisible($h)) { return $true }
    $r = New-Object 'W.U+RECT'
    [void][W.U]::GetWindowRect($h, [ref]$r)
    $w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
    if ($w -lt 60 -or $hh -lt 60 -or $w -gt 1200 -or $hh -gt 1200) { return $true }
    $sb = New-Object System.Text.StringBuilder 512
    [void][W.U]::GetWindowText($h, $sb, 512)
    $title = $sb.ToString()
    $procId = [uint32]0
    [void][W.U]::GetWindowThreadProcessId($h, [ref]$procId)
    $isCsp = $script:csp -contains $procId
    if ($isCsp -or ($title -match 'smartphone|スマートフォン|スマホ|스마트폰|智慧型手機|智能手机|สมาร์ทโฟน|ponsel')) {
      $tag = 'T'; if ($isCsp) { $tag = 'C' }
      [void]$script:rects.Add(('{0} {1} {2} {3} {4}' -f $tag, $r.Left, $r.Top, $w, $hh))
    }
    return $true
  }
  [void][W.U]::EnumWindows($cb, [IntPtr]::Zero)
  if ($script:rects.Count -eq 0) { Write-Output 'MISS' }
  else { Write-Output ('RECTS ' + ($script:rects -join ';')) }
}
function Shot-Rect($x, $y, $w, $h, $p) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($x, $y, 0, 0, $bmp.Size)
  $bmp.Save($p, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $g.Dispose(); $bmp.Dispose()
  Write-Output 'OK'
}
Write-Output 'READY'
while ($null -ne ($line = [Console]::In.ReadLine())) {
  try { Invoke-Expression $line } catch { Write-Output ('ERR ' + $_.Exception.Message) }
}
`;

let psHelper = null;
let psScriptPath = null;
let psCooldownUntil = 0;

function ensurePsScript() {
  if (psScriptPath && fs.existsSync(psScriptPath)) return psScriptPath;
  psScriptPath = path.join(os.tmpdir(), `iro-capture-${process.pid}.ps1`);
  // The helper matches non-ASCII titles, so the script needs a UTF-8 BOM: Windows
  // PowerShell 5.1 reads a BOM-less .ps1 as ANSI and mangles the CJK/Thai text.
  fs.writeFileSync(psScriptPath, '\uFEFF' + PS_HELPER, 'utf8');
  return psScriptPath;
}

/**
 * Drop the helper and refuse to use it again for a while. A wedged or misbehaving
 * PowerShell must never make a scan slow: the desktop capture carries on by itself.
 */
function dropPsHelper(cooldownMs) {
  const child = psHelper;
  psHelper = null;
  if (child) {
    try { child.stdin.end(); child.kill(); } catch { /* ignore */ }
  }
  psCooldownUntil = Date.now() + (cooldownMs || 15000);
  console.warn(`[capture] Companion helper unavailable; scanning the desktop for ${Math.round((cooldownMs || 15000) / 1000)}s`);
}

function ensurePsHelper() {
  if (psHelper && !psHelper.killed && psHelper.exitCode === null) return psHelper;
  const child = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ensurePsScript(),
  ], { windowsHide: true });
  if (!child.stdout || !child.stdin) {
    // A spawn failure with no stdio: never let it leak or block a scan.
    dropPsHelper(30000);
    throw new Error('capture helper has no stdio');
  }
  // Replies and pending queries live on the child, so a replaced helper can never
  // hand a stale reply to the next one (the bug that made every query after the
  // first timeout time out too).
  child.replyBuffer = '';
  child.replyWaiters = [];
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', () => { /* not fatal: a query just times out */ });
  child.stdout.on('data', (chunk) => {
    child.replyBuffer += chunk;
    let idx;
    while ((idx = child.replyBuffer.indexOf('\n')) >= 0) {
      const line = child.replyBuffer.slice(0, idx).trim();
      child.replyBuffer = child.replyBuffer.slice(idx + 1);
      if (line === 'READY') continue; // the helper's one-off bootstrap line
      child.ready = true;
      const waiter = child.replyWaiters.shift();
      if (waiter) waiter(line);
    }
  });
  child.on('error', () => { if (psHelper === child) dropPsHelper(30000); });
  child.on('exit', () => { if (psHelper === child) psHelper = null; });
  psHelper = child;
  return child;
}

/** Send one expression to the helper and resolve with its one-line reply (or ''). */
function psQuery(expr, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    try { child = ensurePsHelper(); } catch { dropPsHelper(30000); resolve(''); return; }
    let settled = false;
    const done = (line) => { if (settled) return; settled = true; clearTimeout(timer); resolve(line); };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // A late reply may still be in flight; drop the whole helper so it cannot be
      // handed to the next query, and cool down before spawning another.
      dropPsHelper(15000);
      resolve('');
    }, timeoutMs);
    child.replyWaiters.push(done);
    try { child.stdin.write(expr + '\n'); } catch { done(''); }
  });
}

/**
 * Find the Companion dialog and decode its QR. Returns the accepted text, or null
 * when nothing is found (or while the helper is cooling down), so `scanOnce` falls
 * back to the desktop. Several small CSP/dialog windows may be candidates; the QR
 * itself is what confirms the right one.
 */
async function captureCompanionWindow(accept) {
  if (process.platform !== 'win32') return null;
  if (Date.now() < psCooldownUntil) return null;
  // The first query covers the helper's one-off Add-Type compile; once the helper
  // has answered, a reply is expected in well under a second.
  const findTimeout = psHelper && psHelper.ready ? 2500 : 6000;
  const found = await psQuery('Find-Companion', findTimeout);
  const m = /^RECTS (.+)$/.exec(found);
  if (!m) return null;
  const rects = m[1].split(';')
    .map((s) => s.trim().split(/\s+/))
    .filter((f) => f.length === 5)
    .map(([tag, x, y, w, h]) => ({ csp: tag === 'C', x: Number(x), y: Number(y), w: Number(w), h: Number(h) }))
    .filter((r) => [r.x, r.y, r.w, r.h].every(Number.isFinite));
  // A window of the CSP process is the real dialog; a title-only match is a
  // fallback (and how a test poses as the dialog). Smallest first within each group.
  const byArea = (a, b) => a.w * a.h - b.w * b.h;
  const ordered = [
    ...rects.filter((r) => r.csp).sort(byArea),
    ...rects.filter((r) => !r.csp).sort(byArea),
  ].slice(0, 6);
  for (const { x, y, w, h } of ordered) {
    const text = await shootRect(x, y, w, h);
    if (text && (!accept || accept(text))) return text;
  }
  return null;
}

/** Capture one screen rectangle and decode a QR from it (null on any failure). */
async function shootRect(x, y, w, h) {
  const file = path.join(os.tmpdir(), `csp-win-${process.pid}-${Date.now()}.bmp`);
  const ok = await psQuery(`Shot-Rect ${x} ${y} ${w} ${h} '${file.replace(/'/g, "''")}'`, 3000);
  try {
    if (ok !== 'OK') return null;
    const parsed = parseBmp(fs.readFileSync(file));
    return parsed ? decodeQrFrame(parsed) : null;
  } catch {
    return null;
  } finally {
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  }
}

/** Stop the capture helper (the app is quitting). */
function stopCaptureHelper() {
  if (psHelper && !psHelper.killed) {
    try { psHelper.stdin.end(); psHelper.kill(); } catch { /* ignore */ }
  }
  psHelper = null;
  if (psScriptPath) {
    try { fs.unlinkSync(psScriptPath); } catch { /* ignore */ }
    psScriptPath = null;
  }
}

// Never leave the helper behind when the app exits.
process.on('exit', stopCaptureHelper);

const PS_CAPTURE = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -Namespace CspShim -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[CspShim.Dpi]::SetProcessDPIAware() | Out-Null
$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $vs.Width, $vs.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($vs.Left, $vs.Top, 0, 0, $bmp.Size)
$bmp.Save($env:CSP_SHOT_PATH, [System.Drawing.Imaging.ImageFormat]::Bmp)
$g.Dispose(); $bmp.Dispose()
`;

/** Capture via PowerShell screenshot -> BMP -> pixels. Async: the helper takes ~2 s and
 * must not freeze the main process (IPC, the drag poll, every window). */
function captureWithPowerShell() {
  const file = path.join(os.tmpdir(), `csp-shot-${process.pid}-${Date.now()}.bmp`);
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_CAPTURE], {
      env: { ...process.env, CSP_SHOT_PATH: file },
      timeout: 20000,
      windowsHide: true,
    }, (err) => {
      try {
        if (err) { reject(err); return; }
        const parsed = parseBmp(fs.readFileSync(file));
        resolve(parsed ? [parsed] : []);
      } catch (readErr) {
        reject(readErr);
      } finally {
        try { fs.unlinkSync(file); } catch { /* ignore */ }
      }
    });
  });
}

/** Parse a 24- or 32-bit BI_RGB bottom-up BMP into {width,height,rgba}. */
function parseBmp(buf) {
  if (buf.length < 54 || buf[0] !== 0x42 || buf[1] !== 0x4d) return null;
  const dataOffset = buf.readUInt32LE(10);
  const headerSize = buf.readUInt32LE(14);
  if (headerSize < 40) return null;
  const width = buf.readInt32LE(18);
  const heightRaw = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  const compression = buf.readUInt32LE(30);
  if (compression !== 0) return null; // BI_RGB only
  if (bpp !== 24 && bpp !== 32) return null;
  const topDown = heightRaw < 0;
  const height = Math.abs(heightRaw);
  if (width <= 0 || height <= 0) return null;
  const inBytes = (bpp / 8);
  const rowStride = Math.ceil((width * inBytes) / 4) * 4;
  // Reject a truncated/corrupt header rather than reading past the buffer.
  if (dataOffset < 54 || dataOffset + rowStride * height > buf.length) return null;
  const rgba = Buffer.alloc(width * height * 4, 255);
  for (let y = 0; y < height; y++) {
    const srcRow = topDown ? y : height - 1 - y;
    let src = dataOffset + srcRow * rowStride;
    let dst = y * width * 4;
    for (let x = 0; x < width; x++) {
      rgba[dst] = buf[src + 2];
      rgba[dst + 1] = buf[src + 1];
      rgba[dst + 2] = buf[src];
      rgba[dst + 3] = bpp === 32 ? buf[src + 3] : 255;
      src += inBytes;
      dst += 4;
    }
  }
  return { width, height, rgba };
}

/**
 * Capture every display with whichever backend is available. Electron's
 * desktopCapturer can silently return empty thumbnails on some setups, so fall
 * back to the PowerShell backend (the one the standalone probe uses) and put a
 * timeout on it: a hung capture must not leave a scan — and a parked palette —
 * stuck.
 */
async function captureScreens() {
  if (process.versions.electron) {
    try {
      const frames = await withTimeout(
        captureWithElectron(),
        ELECTRON_CAPTURE_TIMEOUT_MS,
        'screen capture timed out',
      );
      if (frames && frames.length) return frames;
      console.warn('[capture] desktopCapturer returned no frames; falling back to PowerShell');
    } catch (err) {
      console.warn('[capture] desktopCapturer failed:', err.message);
    }
  }
  return captureWithPowerShell();
}

/** Copy a rectangular region out of an RGBA frame. */
function cropRgba(frame, x0, y0, w, h) {
  const out = Buffer.allocUnsafe(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * frame.width + x0) * 4;
    frame.rgba.copy(out, y * w * 4, src, src + w * 4);
  }
  return out;
}

/**
 * Decode a QR from one frame, trying the whole frame first and then a grid of
 * overlapping tiles. The tile pass helps when a small QR sits on a large,
 * high-DPI desktop.
 */
function decodeQrFrame(frame) {
  const direct = decodeQrRgba(frame.rgba, frame.width, frame.height);
  if (direct) return direct;

  const cols = frame.width >= 1600 ? 2 : 1;
  const rows = frame.height >= 1200 ? 2 : 1;
  if (cols === 1 && rows === 1) return null;
  const overlap = 0.12;
  const tw = Math.ceil((frame.width / cols) * (1 + overlap));
  const th = Math.ceil((frame.height / rows) * (1 + overlap));
  const stepX = Math.floor(frame.width / cols);
  const stepY = Math.floor(frame.height / rows);
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const x0 = Math.min(tx * stepX, Math.max(0, frame.width - tw));
      const y0 = Math.min(ty * stepY, Math.max(0, frame.height - th));
      const w = Math.min(tw, frame.width - x0);
      const h = Math.min(th, frame.height - y0);
      const text = decodeQrRgba(cropRgba(frame, x0, y0, w, h), w, h);
      if (text) return text;
    }
  }
  return null;
}

/** One capture pass; returns the first accepted QR text or null. */
let scanCount = 0;
async function scanOnce(accept, decode = decodeQrFrame) {
  scanCount += 1;
  // The Companion dialog first: once the helper is warm this is ~80 ms, so the QR
  // is caught almost the moment the dialog opens.
  const winText = await captureCompanionWindow(accept);
  if (winText) return winText;
  // The desktop is the fallback (a QR that is not a small CSP/dialog window). It
  // costs ~1 s, so run it only every third pass; the quick window-only passes
  // between keep the polling tight.
  if (scanCount % 3 !== 1) return null;
  const frames = await captureScreens();
  for (const frame of frames) {
    const text = await decode(frame);
    if (text && (!accept || accept(text))) return text;
  }
  return null;
}

/**
 * Repeatedly scan until an accepted QR appears or the timeout elapses.
 * @returns {Promise<string|null>}
 */
async function findQr({ accept, timeoutMs = 60000, intervalMs = 700, onAttempt } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 1; Date.now() < deadline; attempt++) {
    try {
      const text = await scanOnce(accept);
      if (text) return text;
    } catch (err) {
      if (onAttempt) onAttempt(attempt, err);
      // A capture failure is retryable in the probe; keep trying until timeout.
    }
    if (onAttempt) onAttempt(attempt);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

module.exports = { decodeQrRgba, decodeQrFrame, bgraToRgba, parseBmp, captureScreens, captureCompanionWindow, isCompanionWindow, stopCaptureHelper, scanOnce, findQr };
