'use strict';

// Native senders: send keystrokes to whatever window
// has focus. This is the fallback for a CSP command the protocol cannot invoke
// (see the `DoQuickAccess` probe), and it follows the capture helper's pattern —
// one long-lived PowerShell process, compiled once, answering one expression per
// line — so an invocation never pays the `Add-Type` cost.
//
// It is Windows-only. `toSendKeys` is pure and unit-tested; the PowerShell side
// uses `System.Windows.Forms.SendKeys`, the classic dependency-free route.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MODS = { ctrl: '^', control: '^', shift: '+', alt: '%' };
const NAMED = {
  delete: '{DELETE}', backspace: '{BACKSPACE}', enter: '{ENTER}', return: '{ENTER}',
  tab: '{TAB}', esc: '{ESC}', escape: '{ESC}', space: ' ', insert: '{INSERT}',
  up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}',
  home: '{HOME}', end: '{END}', pageup: '{PGUP}', pagedown: '{PGDN}',
};

/**
 * Translate an accelerator (`Ctrl+Shift+S`, `F2`, `Delete`) into the SendKeys
 * syntax (`^+s`, `{F2}`, `{DELETE}`). Returns '' when there is no key.
 */
function toSendKeys(accel) {
  // An accelerator is a key combo, never a script: the helper runs every line it
  // reads through Invoke-Expression (sender.js PS_SENDER), so anything outside this
  // set — newline, quote, `$`, backtick — is refused here (docs/STATE.md).
  if (!/^[A-Za-z0-9 +\-\[\]]*$/.test(String(accel || ''))) return '';
  const parts = String(accel || '').split('+').map((s) => s.trim()).filter(Boolean);
  let mods = '';
  let key = '';
  for (const part of parts) {
    const low = part.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(MODS, low)) {
      if (!mods.includes(MODS[low])) mods += MODS[low];
      continue;
    }
    key = part;
  }
  if (!key) return '';
  const low = key.toLowerCase();
  let body;
  if (/^[a-z0-9]$/.test(low)) body = low;
  else if (/^f([1-9]|1[0-2])$/.test(low)) body = `{${low.toUpperCase()}}`;
  else if (NAMED[low]) body = NAMED[low];
  else body = `{${key.toUpperCase()}}`;
  return mods + body;
}

const PS_SENDER = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace W -Name P -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
'@
function Send-Keys($spec) {
  [System.Windows.Forms.SendKeys]::SendWait($spec)
  Write-Output 'OK'
}
function Post-Msg($hwnd, $msg, $wp, $lp) {
  [void][W.P]::PostMessage([IntPtr][int64]$hwnd, [uint32]$msg, [IntPtr][int64]$wp, [IntPtr][int64]$lp)
  Write-Output 'OK'
}
Write-Output 'READY'
while ($null -ne ($line = [Console]::In.ReadLine())) {
  try { Invoke-Expression $line } catch { Write-Output ('ERR ' + $_.Exception.Message) }
}
`;

function createSender({ platform = process.platform } = {}) {
  const available = platform === 'win32';
  let child = null;
  let scriptPath = null;
  let cooldownUntil = 0;

  function ensureScript() {
    if (scriptPath && fs.existsSync(scriptPath)) return scriptPath;
    scriptPath = path.join(os.tmpdir(), `iro-sender-${process.pid}.ps1`);
    fs.writeFileSync(scriptPath, '\uFEFF' + PS_SENDER, 'utf8');
    return scriptPath;
  }

  function dropChild(cooldownMs) {
    const c = child;
    child = null;
    if (c) { try { c.stdin.end(); c.kill(); } catch { /* ignore */ } }
    cooldownUntil = Date.now() + (cooldownMs || 15000);
  }

  function ensureChild() {
    if (child && !child.killed && child.exitCode === null) return child;
    const c = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ensureScript(),
    ], { windowsHide: true });
    if (!c.stdout || !c.stdin) { dropChild(30000); throw new Error('sender helper has no stdio'); }
    c.replyBuffer = '';
    c.replyWaiters = [];
    c.stdout.setEncoding('utf8');
    c.stderr.setEncoding('utf8');
    c.stderr.on('data', () => { /* a query just times out */ });
    c.stdout.on('data', (chunk) => {
      c.replyBuffer += chunk;
      let idx;
      while ((idx = c.replyBuffer.indexOf('\n')) >= 0) {
        const line = c.replyBuffer.slice(0, idx).trim();
        c.replyBuffer = c.replyBuffer.slice(idx + 1);
        if (line === 'READY') continue;
        const waiter = c.replyWaiters.shift();
        if (waiter) waiter(line);
      }
    });
    c.on('error', () => { if (child === c) dropChild(30000); });
    c.on('exit', () => { if (child === c) child = null; });
    child = c;
    return c;
  }

  function query(expr, timeoutMs) {
    return new Promise((resolve) => {
      if (Date.now() < cooldownUntil) { resolve(''); return; }
      let c;
      try { c = ensureChild(); } catch { resolve(''); return; }
      let settled = false;
      const done = (line) => { if (settled) return; settled = true; clearTimeout(timer); resolve(line); };
      const timer = setTimeout(() => { dropChild(15000); done(''); }, timeoutMs);
      c.replyWaiters.push(done);
      try { c.stdin.write(expr + '\n'); } catch { done(''); }
    });
  }

  /** Send one accelerator (e.g. `Ctrl+Shift+S`) to the focused window. */
  async function sendKeys(accel) {
    if (!available) return { ok: false, spec: '', error: 'not Windows' };
    const spec = toSendKeys(accel);
    if (!spec) return { ok: false, spec, error: `cannot translate "${accel}"` };
    const reply = await query(`Send-Keys '${spec.replace(/'/g, "''")}'`, 3000);
    return { ok: reply === 'OK', spec, error: reply === 'OK' ? '' : (reply || 'no reply') };
  }

  /** Post a window message (for a future direct actuator). */
  async function sendWindowMessage(hwnd, msg, wParam = 0, lParam = 0) {
    if (!available) return { ok: false, error: 'not Windows' };
    const reply = await query(`Post-Msg ${Number(hwnd)} ${Number(msg)} ${Number(wParam)} ${Number(lParam)}`, 3000);
    return { ok: reply === 'OK', error: reply === 'OK' ? '' : (reply || 'no reply') };
  }

  function stop() {
    dropChild(0);
    if (scriptPath) { try { fs.unlinkSync(scriptPath); } catch { /* ignore */ } scriptPath = null; }
  }

  return { available, sendKeys, sendWindowMessage, stop };
}

module.exports = { createSender, toSendKeys };
