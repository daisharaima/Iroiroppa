# Bare-key shortcut watcher.
#
# A bare key cannot use RegisterHotKey (it would swallow ordinary typing), so this
# helper installs a low-level keyboard hook, asks a local typing guard whether the
# user is typing, and only then blocks/emits the key. Main keeps it informed:
#
#   active 1 / active 0   -- CSP or an Iroiroppa window is foreground
#   typing 1 / typing 0   -- an Iroiroppa text field has focus
#   quit
#
#   {"event":"ready"} / {"event":"down"} / {"event":"up"} / {"event":"gone"}
#
# `-Probe` prints the guard verdict for the current foreground and exits.

param(
  [Parameter(Mandatory = $true)][int]$Vk,
  [Parameter(Mandatory = $true)][int]$ParentPid,
  [switch]$Probe
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class IroBareKey {
  private const int WH_KEYBOARD_LL = 13;
  private const int WM_KEYDOWN = 0x0100;
  private const int WM_KEYUP = 0x0101;
  private const int WM_SYSKEYDOWN = 0x0104;
  private const int WM_SYSKEYUP = 0x0105;
  private const int WM_TIMER = 0x0113;
  private const int WM_QUIT = 0x0012;
  private const int VK_CONTROL = 0x11;
  private const int VK_SHIFT = 0x10;
  private const int VK_MENU = 0x12;
  private const int VK_LWIN = 0x5B;
  private const int VK_RWIN = 0x5C;
  private const uint IDC_IBEAM = 32513;
  private const uint GA_ROOT = 2;

  [StructLayout(LayoutKind.Sequential)]
  private struct POINT { public int X; public int Y; }

  [StructLayout(LayoutKind.Sequential)]
  private struct MSG {
    public IntPtr hwnd;
    public uint message;
    public UIntPtr wParam;
    public IntPtr lParam;
    public uint time;
    public POINT pt;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct KBDLLHOOKSTRUCT {
    public uint vkCode;
    public uint scanCode;
    public uint flags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct RECT { public int Left, Top, Right, Bottom; }

  [StructLayout(LayoutKind.Sequential)]
  private struct GUITHREADINFO {
    public uint cbSize;
    public uint flags;
    public IntPtr hwndActive;
    public IntPtr hwndFocus;
    public IntPtr hwndCapture;
    public IntPtr hwndMenuOwner;
    public IntPtr hwndMoveSize;
    public IntPtr hwndCaret;
    public RECT rcCaret;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct CURSORINFO {
    public uint cbSize;
    public uint flags;
    public IntPtr hCursor;
    public POINT ptScreenPos;
  }

  private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn,
    IntPtr hMod, uint dwThreadId);
  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool UnhookWindowsHookEx(IntPtr hhk);
  [DllImport("user32.dll")]
  private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
  [DllImport("kernel32.dll")]
  private static extern IntPtr GetModuleHandle(string lpModuleName);
  [DllImport("user32.dll")]
  private static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);
  [DllImport("user32.dll")]
  private static extern bool TranslateMessage(ref MSG lpMsg);
  [DllImport("user32.dll")]
  private static extern IntPtr DispatchMessage(ref MSG lpMsg);
  [DllImport("user32.dll")]
  private static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll")]
  private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO lpgui);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern int GetClassName(IntPtr hWnd, StringBuilder name, int max);
  [DllImport("user32.dll")]
  private static extern bool GetCursorInfo(ref CURSORINFO pci);
  [DllImport("user32.dll")]
  private static extern IntPtr LoadCursor(IntPtr hInstance, IntPtr lpCursorName);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
  private static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("imm32.dll")]
  private static extern IntPtr ImmGetContext(IntPtr hWnd);
  [DllImport("imm32.dll")]
  private static extern bool ImmGetOpenStatus(IntPtr himc);
  [DllImport("imm32.dll")]
  private static extern bool ImmReleaseContext(IntPtr hWnd, IntPtr himc);
  [DllImport("user32.dll")]
  private static extern bool PostThreadMessage(uint idThread, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")]
  private static extern UIntPtr SetTimer(IntPtr hWnd, UIntPtr nIDEvent, uint uElapse, IntPtr lpTimerFunc);
  [DllImport("user32.dll")]
  private static extern bool KillTimer(IntPtr hWnd, UIntPtr uIDEvent);

  private static LowLevelKeyboardProc callback;
  private static IntPtr hook = IntPtr.Zero;
  private static UIntPtr timerId = UIntPtr.Zero;
  private static uint mainThreadId;
  private static int targetVk;
  private static int parentPid;
  private static volatile bool active = true;
  private static volatile bool typing;
  private static volatile bool quit;
  private static bool claimed;

  public static void Run(int vk, int parent) {
    targetVk = vk;
    parentPid = parent;
    mainThreadId = GetCurrentThreadId();
    Thread reader = new Thread(ReadStdin);
    reader.IsBackground = true;
    reader.Start();
    callback = OnKey;
    hook = SetWindowsHookEx(WH_KEYBOARD_LL, callback, GetModuleHandle(null), 0);
    if (hook == IntPtr.Zero) {
      Write("{\"event\":\"unavailable\"}");
      Environment.Exit(3);
    }
    Write("{\"event\":\"ready\"}");
    timerId = SetTimer(IntPtr.Zero, (UIntPtr)1, 250, IntPtr.Zero);
    MSG msg;
    while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {
      if (msg.message == WM_TIMER && (quit || !ParentAlive())) {
        break;
      }
    }
    if (timerId != UIntPtr.Zero) KillTimer(IntPtr.Zero, timerId);
    UnhookWindowsHookEx(hook);
    Write("{\"event\":\"gone\"}");
  }

  private static void ReadStdin() {
    try {
      string line;
      while ((line = Console.In.ReadLine()) != null) {
        string s = line.Trim().ToLowerInvariant();
        if (s == "active 1") active = true;
        else if (s == "active 0") active = false;
        else if (s == "typing 1") typing = true;
        else if (s == "typing 0") typing = false;
        else if (s == "quit") break;
      }
    } catch { /* parent went away */ }
    quit = true;
    active = false;
    PostThreadMessage(mainThreadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
  }

  private static bool ParentAlive() {
    try { return !Process.GetProcessById(parentPid).HasExited; }
    catch { return false; }
  }

  private static IntPtr OnKey(int nCode, IntPtr wParam, IntPtr lParam) {
    if (nCode >= 0) {
      int message = wParam.ToInt32();
      KBDLLHOOKSTRUCT info = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(
        lParam, typeof(KBDLLHOOKSTRUCT));
      if (info.vkCode == targetVk) {
        bool down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
        bool up = message == WM_KEYUP || message == WM_SYSKEYUP;
        if (down) {
          if (claimed) return (IntPtr)1; // auto-repeat while held
          if (active && !ModifierDown() && !typing && !NativeTyping()) {
            claimed = true;
            Write("{\"event\":\"down\"}");
            return (IntPtr)1;
          }
        } else if (up && claimed) {
          claimed = false;
          Write("{\"event\":\"up\"}");
          return (IntPtr)1;
        }
      }
    }
    return CallNextHookEx(hook, nCode, wParam, lParam);
  }

  private static bool ModifierDown() {
    return (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0
      || (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0
      || (GetAsyncKeyState(VK_MENU) & 0x8000) != 0
      || (GetAsyncKeyState(VK_LWIN) & 0x8000) != 0
      || (GetAsyncKeyState(VK_RWIN) & 0x8000) != 0;
  }

  private static bool NativeTyping() {
    IntPtr fg = GetForegroundWindow();
    if (fg == IntPtr.Zero) return false;
    StringBuilder cls = new StringBuilder(256);
    GetClassName(fg, cls, 256);
    if (cls.ToString() == "#32770") return true;

    uint pid;
    uint thread = GetWindowThreadProcessId(fg, out pid);
    GUITHREADINFO gui = new GUITHREADINFO();
    gui.cbSize = (uint)Marshal.SizeOf(typeof(GUITHREADINFO));
    if (thread != 0 && GetGUIThreadInfo(thread, ref gui)) {
      if (gui.hwndCaret != IntPtr.Zero) return true;
      if ((gui.flags & 1) != 0) return true; // GUI_CARETBLINKING
    }

    IntPtr ime = ImmGetContext(fg);
    if (ime != IntPtr.Zero) {
      bool open = ImmGetOpenStatus(ime);
      ImmReleaseContext(fg, ime);
      if (open) return true;
    }

    CURSORINFO ci = new CURSORINFO();
    ci.cbSize = (uint)Marshal.SizeOf(typeof(CURSORINFO));
    if (GetCursorInfo(ref ci) && ci.hCursor != IntPtr.Zero) {
      IntPtr ibeam = LoadCursor(IntPtr.Zero, (IntPtr)IDC_IBEAM);
      if (ibeam != IntPtr.Zero && ci.hCursor == ibeam) return true;
    }
    return false;
  }

  public static void Probe() {
    Console.WriteLine("{\"event\":\"probe\",\"active\":" + (active ? "true" : "false")
      + ",\"typing\":" + (typing ? "true" : "false")
      + ",\"nativeTyping\":" + (NativeTyping() ? "true" : "false") + "}");
  }

  [DllImport("kernel32.dll")]
  private static extern uint GetCurrentThreadId();

  private static void Write(string json) {
    Console.Out.WriteLine(json);
    Console.Out.Flush();
  }
}
'@

if ($Probe) {
  [IroBareKey]::Probe()
  exit 0
}

[IroBareKey]::Run($Vk, $ParentPid)
