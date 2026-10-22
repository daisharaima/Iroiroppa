# Emits the process name of the current foreground window as soon as Windows
# raises EVENT_SYSTEM_FOREGROUND, instead of polling every 300 ms. Auto-hide uses
# this event to hide immediately when Clip Studio Paint loses focus.
# `-Once` prints one line and exits (diagnostics / tests).
param([switch]$Once)

Add-Type @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class CspForegroundHook {
    private const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
    private const uint WINEVENT_OUTOFCONTEXT = 0x0000;

    private delegate void WinEventProc(IntPtr hook, uint eventType, IntPtr hwnd,
        int idObject, int idChild, uint thread, uint time);

    [StructLayout(LayoutKind.Sequential)] private struct MSG {
        public IntPtr hwnd; public uint message; public IntPtr wParam;
        public IntPtr lParam; public uint time; public int x; public int y;
    }

    [DllImport("user32.dll")] private static extern IntPtr SetWinEventHook(
        uint min, uint max, IntPtr module, WinEventProc proc, uint processId,
        uint threadId, uint flags);
    [DllImport("user32.dll")] private static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(
        IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")] private static extern bool GetMessage(
        out MSG msg, IntPtr hwnd, uint min, uint max);

    private static WinEventProc callback; // rooted: the hook must not collect it
    private static IntPtr hook = IntPtr.Zero;
    private static string last = null;

    public static void Run(bool once) {
        Emit();
        if (once) return;
        callback = OnForeground;
        hook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND,
            IntPtr.Zero, callback, 0, 0, WINEVENT_OUTOFCONTEXT);
        if (hook == IntPtr.Zero) {
            Poll();
            return;
        }
        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0)) { }
        UnhookWinEvent(hook);
    }

    private static void OnForeground(IntPtr h, uint eventType, IntPtr hwnd,
        int idObject, int idChild, uint thread, uint time) {
        Emit();
    }

    private static void Poll() {
        while (true) {
            Emit();
            System.Threading.Thread.Sleep(300);
        }
    }

    private static void Emit() {
        try {
            IntPtr hwnd = GetForegroundWindow();
            uint pid = 0;
            GetWindowThreadProcessId(hwnd, out pid);
            string name = "";
            if (pid != 0) {
                try { name = Process.GetProcessById((int)pid).ProcessName; }
                catch { name = ""; }
            }
            if (name != last) {
                last = name;
                Console.Out.WriteLine(name);
                Console.Out.Flush();
            }
        } catch { }
    }
}
"@

[CspForegroundHook]::Run($Once.IsPresent)
