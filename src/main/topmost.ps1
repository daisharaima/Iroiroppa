param(
  [Parameter(Mandatory = $true)][string]$Hwnd
)

# Put one of our windows into the WS_EX_TOPMOST band, without moving, resizing or
# activating it.
#
# Why this exists: on some Windows 11 builds (seen on 10.0.26300 after the
# 21 Oct 2026 updates) Chromium's own always-on-top request never reaches
# SetWindowPos — `win.setAlwaysOnTop(true)` leaves `isAlwaysOnTop()` false and the
# window sits at the bottom of the z-order, which for a non-activating palette
# looks like "it is stuck behind everything". A direct SetWindowPos still works,
# so main calls this as a fallback (src/main/topmost.js) only when the runtime
# says the window is not on top.

Add-Type -Language CSharp @'
using System;
using System.Runtime.InteropServices;
public class IroTopmost {
  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  public static bool Raise(long hwnd) {
    // HWND_TOPMOST (-1); SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE
    return SetWindowPos(new IntPtr(hwnd), new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010);
  }
}
'@

[void][IroTopmost]::Raise([long]$Hwnd)
