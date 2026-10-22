# Emits left-button events over Clip Studio Paint (pen and mouse both arrive as
# the left mouse button):
#   {"event":"down","canvas":<bool>,"alt":<bool>,"process":"..."}
#   {"event":"up","process":"..."}
#
# History uses `up` as the precise end of a pick gesture, and `down` (canvas only,
# no Alt) as the "colour was actually used" contact for the drawing-only gate.
# The canvas check is the one verified live on CSP 5.0.4: a large, titleless child
# whose class carries two GUIDs, under the single-GUID CSP root. The Colour Wheel,
# Slider and docked palettes are top-level windows, so they are not canvas.
#
# `-Probe` prints events and exits after `-Seconds` (docs/DEV.md); the app runs it
# without arguments and kills it on quit.
param([switch]$Probe, [int]$Seconds = 0, [int]$ParentPid = 0)

Add-Type @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

public static class CspPointerHook {
    private const int WH_MOUSE_LL = 14;
    private const int WM_LBUTTONDOWN = 0x0201;
    private const int WM_LBUTTONUP = 0x0202;
    private const int WM_TIMER = 0x0113;
    private const int VK_MENU = 0x12;
    private const uint GA_ROOT = 2;

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSLLHOOKSTRUCT {
        public POINT pt;
        public uint mouseData;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int x;
        public int y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    private delegate IntPtr LowLevelMouseProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")] private static extern IntPtr SetWindowsHookEx(
        int idHook, LowLevelMouseProc proc, IntPtr module, uint threadId);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(
        IntPtr hook, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32.dll")] private static extern IntPtr SetTimer(
        IntPtr hwnd, IntPtr id, uint elapse, IntPtr proc);
    [DllImport("user32.dll")] private static extern bool KillTimer(IntPtr hwnd, IntPtr id);
    [DllImport("user32.dll")] private static extern bool GetMessage(
        out MSG msg, IntPtr hwnd, uint min, uint max);
    [DllImport("user32.dll")] private static extern void PostQuitMessage(int code);
    [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(POINT pt);
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out POINT pt);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(
        IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);

    private static readonly Regex CanvasClass = new Regex(
        "^[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}-[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);
    // The top-level CSP window is the first GUID only; a floating Colour Wheel
    // shares the two-GUID class, which is why the hierarchy matters.
    private static readonly Regex RootClass = new Regex(
        "^[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static LowLevelMouseProc callback; // rooted
    private static IntPtr hook = IntPtr.Zero;
    private static IntPtr timerId = (IntPtr)1;
    private static DateTime endAt = DateTime.MaxValue;
    private static int parentPid;
    private static bool probe;
    private static bool wasDown;
    private static readonly System.Collections.Generic.Dictionary<uint, string> procNames
        = new System.Collections.Generic.Dictionary<uint, string>();

    public static void Run(bool isProbe, int seconds, int parent) {
        probe = isProbe;
        parentPid = parent;
        if (seconds > 0) endAt = DateTime.UtcNow.AddSeconds(seconds);
        callback = OnMouse;
        hook = SetWindowsHookEx(WH_MOUSE_LL, callback, GetModuleHandle(null), 0);
        if (hook == IntPtr.Zero) { Console.Error.WriteLine("hook-unavailable"); Poll(); return; }
        Console.Error.WriteLine("hook-installed");
        timerId = SetTimer(IntPtr.Zero, timerId, 250, IntPtr.Zero);
        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0)) {
            if (msg.message == WM_TIMER) {
                if (DateTime.UtcNow >= endAt) {
                    PostQuitMessage(0);
                    break;
                }
                // Do not outlive the app: a force-killed Electron never runs
                // will-quit, and this helper must not linger as an orphan.
                if (parentPid > 0 && !ParentAlive()) {
                    PostQuitMessage(0);
                    break;
                }
            }
        }
        if (timerId != IntPtr.Zero) KillTimer(IntPtr.Zero, timerId);
        UnhookWindowsHookEx(hook);
    }

    private static bool ParentAlive() {
        try { return !Process.GetProcessById(parentPid).HasExited; }
        catch { return false; }
    }

    /** Fallback when a hook cannot be installed: watch the button state. */
    private static void Poll() {
        while (DateTime.UtcNow < endAt) {
            bool down = (GetAsyncKeyState(1) & 0x8000) != 0;
            POINT pt;
            if (down && !wasDown && GetCursorPos(out pt)) EmitDown(pt);
            if (!down && wasDown && GetCursorPos(out pt)) EmitUp(pt);
            wasDown = down;
            System.Threading.Thread.Sleep(40);
        }
    }

    private static IntPtr OnMouse(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0) {
            int message = wParam.ToInt32();
            if (message == WM_LBUTTONDOWN || message == WM_LBUTTONUP) {
                MSLLHOOKSTRUCT info = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(
                    lParam, typeof(MSLLHOOKSTRUCT));
                if (message == WM_LBUTTONDOWN) EmitDown(info.pt);
                else EmitUp(info.pt);
            }
        }
        return CallNextHookEx(hook, nCode, wParam, lParam);
    }

    private static void EmitDown(POINT pt) {
        string name = ProcessNameAt(pt);
        if (!probe && !IsCsp(name)) return;
        bool canvas = IsCanvasAt(pt);
        bool alt = Alt();
        if (probe) Console.Error.WriteLine("down over " + name + " canvas=" + canvas + " alt=" + alt);
        Write("{\"event\":\"down\",\"canvas\":" + (canvas ? "true" : "false")
            + ",\"alt\":" + (alt ? "true" : "false")
            + ",\"process\":\"" + Escape(name) + "\"}");
    }

    private static void EmitUp(POINT pt) {
        string name = ProcessNameAt(pt);
        if (!probe && !IsCsp(name)) return;
        if (probe) Console.Error.WriteLine("up over " + name);
        Write("{\"event\":\"up\",\"process\":\"" + Escape(name) + "\"}");
    }

    private static void Write(string json) {
        Console.Out.WriteLine(json);
        Console.Out.Flush();
    }

    /** True when the point is on CSP's canvas (not a floating/docked UI surface). */
    private static bool IsCanvasAt(POINT pt) {
        IntPtr hwnd = WindowFromPoint(pt);
        if (hwnd == IntPtr.Zero) return false;
        uint pid = 0;
        GetWindowThreadProcessId(hwnd, out pid);
        if (pid == 0 || !IsCsp(ProcessNameOf(pid))) return false;
        StringBuilder cls = new StringBuilder(256);
        GetClassName(hwnd, cls, 256);
        if (!CanvasClass.IsMatch(cls.ToString())) return false;

        IntPtr root = GetAncestor(hwnd, GA_ROOT);
        if (root == IntPtr.Zero || root == hwnd) return false;
        StringBuilder rootCls = new StringBuilder(256);
        GetClassName(root, rootCls, 256);
        if (!RootClass.IsMatch(rootCls.ToString())) return false;

        // Canvas children have no title; palette windows do.
        StringBuilder title = new StringBuilder(256);
        if (GetWindowText(hwnd, title, 256) > 0) return false;

        // A docked panel can be a child too; the canvas is the large view.
        RECT child, rootRect;
        if (!GetWindowRect(hwnd, out child) || !GetWindowRect(root, out rootRect)) return false;
        long childArea = (long)(child.Right - child.Left) * (child.Bottom - child.Top);
        long rootArea = (long)(rootRect.Right - rootRect.Left) * (rootRect.Bottom - rootRect.Top);
        return childArea > 0 && rootArea > 0 && childArea * 4 >= rootArea;
    }

    private static bool Alt() {
        return (GetAsyncKeyState(VK_MENU) & 0x8000) != 0;
    }

    private static bool IsCsp(string name) {
        return name.IndexOf("ClipStudioPaint", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    private static string Escape(string s) {
        return s.Replace("\\", "\\\\").Replace("\"", "\\\"");
    }

    private static string ProcessNameAt(POINT pt) {
        IntPtr hwnd = WindowFromPoint(pt);
        if (hwnd == IntPtr.Zero) return "";
        uint pid = 0;
        GetWindowThreadProcessId(hwnd, out pid);
        return ProcessNameOf(pid);
    }

    private static string ProcessNameOf(uint pid) {
        if (pid == 0) return "";
        string name;
        if (procNames.TryGetValue(pid, out name)) return name;
        try { name = Process.GetProcessById((int)pid).ProcessName; }
        catch { name = ""; }
        procNames[pid] = name;
        return name;
    }
}
"@

[CspPointerHook]::Run($Probe.IsPresent, $Seconds, $ParentPid)
