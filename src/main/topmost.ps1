param(
  [Parameter(Mandatory = $true)][string]$Hwnd,
  [int]$NoActivate = 1,
  [int]$Topmost = 1,
  [int]$Zorder = 1,
  [int]$Watch = 0
)

# Apply the two window bits a non-activating palette needs, in one native call:
#
#   WS_EX_NOACTIVATE  the window never takes the foreground, so clicking the
#                     palette leaves Clip Studio Paint focused;
#   WS_EX_TOPMOST     it floats above Clip Studio Paint.
#
# Why this exists at all: on Windows 11 build 26300 (the Oct 2026 updates) the
# runtime drops Chromium's own always-on-top request *and* — the second half of the
# same breakage — a click on a window Chromium considers non-activatable never
# reaches the page (moves and releases do; only the press is lost). The palette is
# therefore created activatable (Electron `focusable: true`, so Chromium delivers
# the press) and kept out of the activation path with WS_EX_NOACTIVATE instead of
# with `focusable: false`.
#
# Chromium rewrites the extended style when it tries to activate the window on a
# click, which drops the topmost bit; so src/main/topmost.js re-applies the band
# after every show and after every press. With `-Watch` this script stays alive and
# applies one `hwnd|noActivate|topmost` line from stdin at a time, because spawning
# a PowerShell per press was both slow and a way for its hidden console to flash the
# foreground (which made the auto-hide watcher hide the palette).

Add-Type -Language CSharp @'
using System;
using System.Runtime.InteropServices;
public class IroBand {
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
  public static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
  public static extern IntPtr SetWindowLongPtr(IntPtr h, int i, IntPtr v);
  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);

  const int GWL_EXSTYLE = -20;
  const long WS_EX_TOPMOST = 0x8;
  const long WS_EX_NOACTIVATE = 0x08000000;
  // HWND_TOPMOST(-1) / HWND_NOTOPMOST(-2) as the insert-after handle.
  // SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOREDRAW — no SWP_FRAMECHANGED:
  // a frame recalc on every band call is what made the palette flash when a press
  // repaired the band. NOREDRAW also keeps a style-only repair from repainting the
  // whole topmost band every 500 ms.
  const uint FLAGS = 0x0001 | 0x0002 | 0x0008 | 0x0010;
  const uint SWP_NOZORDER = 0x0004;

  public static bool Apply(long hwnd, bool noActivate, bool topmost, bool zorder) {
    IntPtr h = new IntPtr(hwnd);
    if (h == IntPtr.Zero) return false;
    long ex = GetWindowLongPtr(h, GWL_EXSTYLE).ToInt64();
    long want = ex;
    if (noActivate) want |= WS_EX_NOACTIVATE;
    else want &= ~WS_EX_NOACTIVATE;
    if (topmost) want |= WS_EX_TOPMOST;
    else want &= ~WS_EX_TOPMOST;
    bool changed = want != ex;
    if (changed) SetWindowLongPtr(h, GWL_EXSTYLE, new IntPtr(want));
    // zorder=false repairs the style bit without moving the window in the topmost
    // band. If the bits already match there is nothing to repair: skipping the
    // SetWindowPos is what stops the 500 ms watchdog from making every window
    // flash. A style change still needs the call to commit the new extended style.
    if (!zorder) {
      if (!changed) return true;
      return SetWindowPos(h, IntPtr.Zero, 0, 0, 0, 0, FLAGS | SWP_NOZORDER);
    }
    return SetWindowPos(h, new IntPtr(topmost ? -1 : -2), 0, 0, 0, 0, FLAGS);
  }
}
'@

if ($Watch -ne 0) {
  # One line per request: <hwnd>|<noActivate>|<topmost>|<zorder>. The parent writes to
  # our stdin and never waits; when it closes stdin we exit.
  $reader = [Console]::In
  while ($null -ne ($line = $reader.ReadLine())) {
    $parts = $line.Trim().Split('|')
    if ($parts.Length -lt 3) { continue }
    $z = if ($parts.Length -ge 4) { $parts[3] -ne '0' } else { $true }
    [void][IroBand]::Apply([long]$parts[0], ($parts[1] -ne '0'), ($parts[2] -ne '0'), $z)
  }
} else {
  [void][IroBand]::Apply([long]$Hwnd, ($NoActivate -ne 0), ($Topmost -ne 0), ($Zorder -ne 0))
}
