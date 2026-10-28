# A hold-to-show key watcher.
#
# Electron's globalShortcut can only tell us that a chord was pressed; it never
# reports the release. A hold binding therefore uses RegisterHotKey (which also
# swallows the chord) and polls GetAsyncKeyState until the key or a modifier is
# released. One process per binding keeps this simple and keeps the message loop
# free of a second key.
#
#   keys.ps1 -Vk 80 -Mods 3            stream {"event":"down"} / {"event":"up"}
#   keys.ps1 -Vk 80 -Mods 3 -Check     report whether the chord can be registered
#
# `Mods` is the Windows MOD_* bitfield (Alt 1, Ctrl 2, Shift 4, Win 8).

param(
  [Parameter(Mandatory = $true)][int]$Vk,
  [Parameter(Mandatory = $true)][int]$Mods,
  [switch]$Check
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class IroKeys {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool RegisterHotKey(IntPtr hWnd, int id, int fsModifiers, int vk);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
  [DllImport("user32.dll")]
  public static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);
  [DllImport("user32.dll")]
  public static extern bool TranslateMessage(ref MSG lpMsg);
  [DllImport("user32.dll")]
  public static extern IntPtr DispatchMessage(ref MSG lpMsg);

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }

  [StructLayout(LayoutKind.Sequential)]
  public struct MSG {
    public IntPtr hwnd;
    public uint message;
    public UIntPtr wParam;
    public IntPtr lParam;
    public uint time;
    public POINT pt;
  }
}
'@

$MOD_NOREPEAT = 0x4000
$WM_HOTKEY = 0x0312
$VK_CONTROL = 0x11
$VK_SHIFT = 0x10
$VK_MENU = 0x12
$VK_LWIN = 0x5B
$VK_RWIN = 0x5C

function Emit([string]$json) {
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

function IsDown([int]$code) {
  return (([IroKeys]::GetAsyncKeyState($code)) -band 0x8000) -ne 0
}

if (-not [IroKeys]::RegisterHotKey([IntPtr]::Zero, 1, ($Mods -bor $MOD_NOREPEAT), $Vk)) {
  Emit '{"event":"taken"}'
  exit 2
}

if ($Check) {
  [IroKeys]::UnregisterHotKey([IntPtr]::Zero, 1) | Out-Null
  Emit '{"event":"ready"}'
  exit 0
}

Emit '{"event":"ready"}'

$msg = New-Object IroKeys+MSG
while ([IroKeys]::GetMessage([ref]$msg, [IntPtr]::Zero, 0, 0) -gt 0) {
  if ($msg.message -eq $WM_HOTKEY) {
    Emit '{"event":"down"}'
    # Hold until the physical key (or a modifier the chord needs) goes up.
    while ((IsDown $Vk)) {
      if (($Mods -band 2) -and -not (IsDown $VK_CONTROL)) { break }
      if (($Mods -band 1) -and -not (IsDown $VK_MENU)) { break }
      if (($Mods -band 4) -and -not (IsDown $VK_SHIFT)) { break }
      if (($Mods -band 8) -and -not ((IsDown $VK_LWIN) -or (IsDown $VK_RWIN))) { break }
      Start-Sleep -Milliseconds 20
    }
    Emit '{"event":"up"}'
  }
}

[IroKeys]::UnregisterHotKey([IntPtr]::Zero, 1) | Out-Null
