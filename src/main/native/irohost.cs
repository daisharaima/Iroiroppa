// irohost — the one native helper the app runs.
//
// It owns the three jobs that used to be three PowerShell processes
// (topmost.ps1 -Watch, pointer.ps1, foreground.ps1) and speaks newline-delimited
// JSON: commands arrive on stdin, events leave on stdout. One process, one
// console, no per-event spawn.
//
//   irohost.exe
//
// stdin
//   ping                       -> {"pong":<ms>}
//   topmost <hwnd>             -> {"topmost":1,"hwnd":..,"applied":0|1,"changed":0|1,"swp":0|1,"t":..}
//   state <hwnd>               -> {"state":1,"hwnd":..,"topmost":..,"noactivate":..,"appwindow":..,"t":..}
//   watch <hwnd> [intervalMs]  -> {"watching":<hwnd>,"every":<ms>}     (band watchdog)
//   unwatch                    -> {"watching":0,"repairs":<n>}
//   mouse 1|0                  -> {"mouse":1|0}                        (WH_MOUSE_LL)
//   fg 1|0                     -> {"fg":1|0}                           (EVENT_SYSTEM_FOREGROUND)
//   quit                       -> {"bye":<ms>} then exit
//
// stdout (unsolicited)
//   {"ready":<ms>,"pid":..,"version":".."}
//   {"mouse":"down"|"up","x":..,"y":..,"t":..}
//   {"fg":"CSP.exe","hwnd":..,"t":..}
//   {"repair":<hwnd>,"n":..,"t":..}
//   {"hook":1|0,"t":..}        mouse hook state, echoed when it changes
//   {"error":"..","t":..}
//
// Built by `node scripts/build-host.js` with the in-box C# compiler; the binary
// is shipped in the packaged app (never compiled at launch — an unsigned binary
// produced on first run is exactly what application control blocks).

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class Program
{
    private const string Version = "1.0.0";

    // --- window styles -----------------------------------------------------
    private const int GWL_EXSTYLE = -20;
    private const long WS_EX_NOACTIVATE = 0x08000000L;
    private const long WS_EX_TOPMOST = 0x00000008L;
    private const long WS_EX_APPWINDOW = 0x00040000L;

    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOREDRAW = 0x0008;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_NOOWNERZORDER = 0x0200;

    // --- hooks -------------------------------------------------------------
    private const int WH_MOUSE_LL = 14;
    private const int WM_MOUSEMOVE = 0x0200;
    private const int WM_LBUTTONDOWN = 0x0201;
    private const int WM_LBUTTONUP = 0x0202;
    private const uint WM_QUIT = 0x0012;
    private const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
    private const uint WINEVENT_OUTOFCONTEXT = 0x0000;
    private const uint WINEVENT_SKIPOWNPROCESS = 0x0002;

    // --- process access ----------------------------------------------------
    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

    private delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);
    private delegate void WinEventProc(IntPtr hWinEventHook, uint eventType, IntPtr hwnd,
        int idObject, int idChild, uint dwEventThread, uint dwmsEventTime);

    [StructLayout(LayoutKind.Sequential)]
    private struct MSLLHOOKSTRUCT
    {
        public int x;
        public int y;
        public uint mouseData;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int x;
        public int y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int x;
        public int y;
    }

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
    private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int index, IntPtr value);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongW", SetLastError = true)]
    private static extern int SetWindowLong32(IntPtr hWnd, int index, int value);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)]
    private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int index);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW", SetLastError = true)]
    private static extern int GetWindowLong32(IntPtr hWnd, int index);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, HookProc proc, IntPtr hMod, uint threadId);
    [DllImport("user32.dll")]
    private static extern bool UnhookWindowsHookEx(IntPtr hHook);
    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hHook, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    private static extern int GetMessage(out MSG msg, IntPtr hWnd, uint min, uint max);
    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref MSG msg);
    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref MSG msg);
    [DllImport("user32.dll")]
    private static extern bool PostThreadMessage(uint threadId, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")]
    private static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr hmodWinEventProc,
        WinEventProc lpfnWinEventProc, uint idProcess, uint idThread, uint dwFlags);
    [DllImport("user32.dll")]
    private static extern bool UnhookWinEvent(IntPtr hWinEventHook);
    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out POINT point);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint processId);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool QueryFullProcessImageName(IntPtr process, uint flags,
        StringBuilder exeName, ref uint size);

    private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    private static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
    private static readonly Stopwatch Clock = Stopwatch.StartNew();
    private static readonly object OutLock = new object();

    private static uint _mainThread;
    private static volatile bool _stop;

    // mouse hook
    private static IntPtr _mouseHook = IntPtr.Zero;
    private static HookProc _mouseProc;          // keep a reference: the GC must not collect it
    private static volatile bool _mouseOn;

    // foreground hook
    private static IntPtr _fgHook = IntPtr.Zero;
    private static WinEventProc _fgProc;
    private static volatile bool _fgOn;
    private static string _lastFg = string.Empty;

    // band watchdog
    private static Thread _watchThread;
    private static volatile bool _watching;
    private static volatile IntPtr _watchHwnd = IntPtr.Zero;
    private static volatile int _watchInterval = 100;
    private static int _repairs;

    private static long NowMs()
    {
        return (long)Clock.Elapsed.TotalMilliseconds;
    }

    private static void Out(string line)
    {
        lock (OutLock)
        {
            try
            {
                Console.Out.Write(line);
                Console.Out.Write('\n');
                Console.Out.Flush();
            }
            catch
            {
                // A closed pipe means the app is gone; stop rather than spin.
                _stop = true;
            }
        }
    }

    private static void Fail(string message)
    {
        Out("{\"error\":\"" + Escape(message) + "\",\"t\":" + NowMs() + "}");
    }

    private static string Escape(string text)
    {
        var sb = new StringBuilder(text.Length + 8);
        foreach (char c in text)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < ' ') sb.Append("\\u").Append(((int)c).ToString("x4"));
                    else sb.Append(c);
                    break;
            }
        }
        return sb.ToString();
    }

    // --- window band -------------------------------------------------------

    private static long GetExStyle(IntPtr hWnd)
    {
        return IntPtr.Size == 8
            ? GetWindowLongPtr64(hWnd, GWL_EXSTYLE).ToInt64()
            : GetWindowLong32(hWnd, GWL_EXSTYLE);
    }

    private static void SetExStyle(IntPtr hWnd, long value)
    {
        if (IntPtr.Size == 8) SetWindowLongPtr64(hWnd, GWL_EXSTYLE, new IntPtr(value));
        else SetWindowLong32(hWnd, GWL_EXSTYLE, (int)value);
    }

    /// Apply both bits and report what the window now says. `changed` is 0 when the
    /// window already carried them, so a caller can tell a repair from a no-op.
    /// Mirrors topmost.ps1's four knobs: set/clear each style bit, then optionally
    /// enter or leave the band with SetWindowPos. `zorder:false` repairs the *bit*
    /// without touching the z-order, which is what keeps a 100 ms tick invisible.
    private static string ApplyTopmost(IntPtr hWnd, bool noActivate, bool topmost, bool zorder)
    {
        if (hWnd == IntPtr.Zero || !IsWindow(hWnd))
            return "{\"topmost\":0,\"error\":\"not-a-window\",\"t\":" + NowMs() + "}";

        long before = GetExStyle(hWnd);

        // Compute the wanted bits, then write only when they differ: a no-op write is
        // what keeps a 10 Hz watchdog off the window's style path.
        long wanted = before;
        if (noActivate) wanted |= WS_EX_NOACTIVATE; else wanted &= ~WS_EX_NOACTIVATE;
        if (topmost) wanted |= WS_EX_TOPMOST; else wanted &= ~WS_EX_TOPMOST;

        bool changed = wanted != before;
        if (changed) SetExStyle(hWnd, wanted);

        bool positioned = false;
        if (zorder)
        {
            positioned = SetWindowPos(hWnd, topmost ? HWND_TOPMOST : HWND_NOTOPMOST, 0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOREDRAW);
        }

        long after = GetExStyle(hWnd);
        bool nowTopmost = (after & WS_EX_TOPMOST) != 0;
        bool nowNoActivate = (after & WS_EX_NOACTIVATE) != 0;

        return "{\"topmost\":1,\"hwnd\":" + hWnd.ToInt64()
            + ",\"applied\":" + (nowTopmost == topmost && nowNoActivate == noActivate ? 1 : 0)
            + ",\"changed\":" + (changed ? 1 : 0)
            + ",\"swp\":" + (positioned ? 1 : 0)
            + ",\"t\":" + NowMs() + "}";
    }

    private static string ReportState(IntPtr hWnd)
    {
        if (hWnd == IntPtr.Zero || !IsWindow(hWnd))
            return "{\"state\":0,\"error\":\"not-a-window\",\"t\":" + NowMs() + "}";

        long ex = GetExStyle(hWnd);
        return "{\"state\":1,\"hwnd\":" + hWnd.ToInt64()
            + ",\"topmost\":" + (((ex & WS_EX_TOPMOST) != 0) ? 1 : 0)
            + ",\"noactivate\":" + (((ex & WS_EX_NOACTIVATE) != 0) ? 1 : 0)
            + ",\"appwindow\":" + (((ex & WS_EX_APPWINDOW) != 0) ? 1 : 0)
            + ",\"t\":" + NowMs() + "}";
    }

    private static void WatchLoop()
    {
        while (_watching)
        {
            int interval = _watchInterval < 20 ? 20 : _watchInterval;
            Thread.Sleep(interval);
            if (!_watching) break;

            IntPtr hWnd = _watchHwnd;
            if (hWnd == IntPtr.Zero || !IsWindow(hWnd)) continue;

            long ex = GetExStyle(hWnd);
            bool ok = (ex & (WS_EX_NOACTIVATE | WS_EX_TOPMOST)) == (WS_EX_NOACTIVATE | WS_EX_TOPMOST);
            if (ok) continue;

            ApplyTopmost(hWnd, true, true, false);
            _repairs++;
            Out("{\"repair\":" + hWnd.ToInt64() + ",\"n\":" + _repairs + ",\"t\":" + NowMs() + "}");
        }
    }

    // --- hooks -------------------------------------------------------------

    /// The callback does nothing but read the struct and queue one line: the
    /// Windows hook has a hard time budget and is silently removed when it is
    /// missed, so no allocation-heavy or blocking work belongs here.
    private static IntPtr MouseCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && _mouseOn)
        {
            int msg = wParam.ToInt32();
            if (msg == WM_LBUTTONDOWN || msg == WM_LBUTTONUP)
            {
                try
                {
                    var data = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
                    string kind = msg == WM_LBUTTONDOWN ? "down" : "up";
                    Out("{\"mouse\":\"" + kind + "\",\"x\":" + data.x + ",\"y\":" + data.y
                        + ",\"t\":" + NowMs() + "}");
                }
                catch
                {
                    // A malformed callback must never break the hook chain.
                }
            }
        }
        return CallNextHookEx(_mouseHook, nCode, wParam, lParam);
    }

    private static void InstallMouseHook()
    {
        if (_mouseHook != IntPtr.Zero) return;
        _mouseProc = MouseCallback;
        _mouseHook = SetWindowsHookEx(WH_MOUSE_LL, _mouseProc, IntPtr.Zero, 0);
        Out("{\"hook\":" + (_mouseHook != IntPtr.Zero ? 1 : 0) + ",\"t\":" + NowMs() + "}");
    }

    private static void RemoveMouseHook()
    {
        if (_mouseHook == IntPtr.Zero) return;
        UnhookWindowsHookEx(_mouseHook);
        _mouseHook = IntPtr.Zero;
        Out("{\"hook\":0,\"t\":" + NowMs() + "}");
    }

    private static string ForegroundName(IntPtr hWnd)
    {
        uint pid;
        GetWindowThreadProcessId(hWnd, out pid);
        if (pid == 0) return string.Empty;

        IntPtr process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (process == IntPtr.Zero) return string.Empty;

        try
        {
            var buffer = new StringBuilder(1024);
            uint size = (uint)buffer.Capacity;
            if (!QueryFullProcessImageName(process, 0, buffer, ref size)) return string.Empty;

            string path = buffer.ToString();
            int slash = path.LastIndexOf('\\');
            return slash >= 0 ? path.Substring(slash + 1) : path;
        }
        finally
        {
            CloseHandle(process);
        }
    }

    private static void EmitForeground()
    {
        IntPtr hWnd = GetForegroundWindow();
        string name = hWnd == IntPtr.Zero ? string.Empty : ForegroundName(hWnd);

        // The watcher only needs a change of app, not a change of window.
        if (string.Equals(name, _lastFg, StringComparison.OrdinalIgnoreCase)) return;
        _lastFg = name;

        Out("{\"fg\":\"" + Escape(name) + "\",\"hwnd\":" + hWnd.ToInt64() + ",\"t\":" + NowMs() + "}");
    }

    private static void FgCallback(IntPtr hWinEventHook, uint eventType, IntPtr hwnd,
        int idObject, int idChild, uint dwEventThread, uint dwmsEventTime)
    {
        if (eventType != EVENT_SYSTEM_FOREGROUND) return;
        try
        {
            EmitForeground();
        }
        catch
        {
            // Never let an event callback throw into user32.
        }
    }

    private static void InstallFgHook()
    {
        if (_fgHook != IntPtr.Zero) return;
        _fgProc = FgCallback;
        _fgHook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, IntPtr.Zero,
            _fgProc, 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
        Out("{\"fg\":1,\"hook\":" + (_fgHook != IntPtr.Zero ? 1 : 0) + ",\"t\":" + NowMs() + "}");
        // Report the current foreground once so the app does not wait for a switch.
        EmitForeground();
    }

    private static void RemoveFgHook()
    {
        if (_fgHook == IntPtr.Zero) return;
        UnhookWinEvent(_fgHook);
        _fgHook = IntPtr.Zero;
        Out("{\"fg\":0,\"t\":" + NowMs() + "}");
    }

    // --- command loop ------------------------------------------------------

    private static IntPtr ParseHwnd(string text)
    {
        if (string.IsNullOrEmpty(text)) return IntPtr.Zero;

        long value;
        if (text.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
            long.TryParse(text.Substring(2), System.Globalization.NumberStyles.HexNumber, null, out value);
        else
            long.TryParse(text, out value);
        return new IntPtr(value);
    }

    private static void HandleLine(string raw)
    {
        string line = (raw ?? string.Empty).Trim();
        if (line.Length == 0) return;

        int sp = line.IndexOf(' ');
        string cmd = sp < 0 ? line : line.Substring(0, sp);
        string arg = sp < 0 ? string.Empty : line.Substring(sp + 1).Trim();

        switch (cmd)
        {
            case "ping":
                Out("{\"pong\":" + NowMs() + "}");
                break;

            case "topmost":
                {
                    string[] parts = arg.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length == 0) { Fail("topmost needs an hwnd"); break; }
                    bool noActivate = parts.Length > 1 ? parts[1] != "0" : true;
                    bool topmostOn = parts.Length > 2 ? parts[2] != "0" : true;
                    bool zorder = parts.Length > 3 ? parts[3] != "0" : true;
                    Out(ApplyTopmost(ParseHwnd(parts[0]), noActivate, topmostOn, zorder));
                }
                break;

            case "state":
                Out(ReportState(ParseHwnd(arg)));
                break;

            case "watch":
                {
                    string[] parts = arg.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length == 0) { Fail("watch needs an hwnd"); break; }

                    _watchHwnd = ParseHwnd(parts[0]);
                    _watchInterval = parts.Length > 1 ? Math.Max(20, ParseInt(parts[1], 100)) : 100;

                    if (_watchThread == null)
                    {
                        _watching = true;
                        _watchThread = new Thread(WatchLoop);
                        _watchThread.IsBackground = true;
                        _watchThread.Start();
                    }
                    Out("{\"watching\":" + _watchHwnd.ToInt64() + ",\"every\":" + _watchInterval + "}");
                }
                break;

            case "unwatch":
                _watching = false;
                _watchThread = null;
                _watchHwnd = IntPtr.Zero;
                Out("{\"watching\":0,\"repairs\":" + _repairs + "}");
                break;

            case "mouse":
                _mouseOn = arg != "0";
                if (_mouseOn) InstallMouseHook(); else RemoveMouseHook();
                Out("{\"mouse\":" + (_mouseOn ? 1 : 0) + "}");
                break;

            case "fg":
                _fgOn = arg != "0";
                if (_fgOn) InstallFgHook(); else RemoveFgHook();
                Out("{\"fg\":" + (_fgOn ? 1 : 0) + "}");
                break;

            case "quit":
                PostThreadMessage(_mainThread, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
                break;

            case "version":
                Out("{\"version\":\"" + Version + "\"}");
                break;

            default:
                Out("{\"error\":\"unknown\",\"cmd\":\"" + Escape(cmd) + "\",\"t\":" + NowMs() + "}");
                break;
        }
    }

    private static int ParseInt(string text, int fallback)
    {
        int value;
        return int.TryParse(text, out value) ? value : fallback;
    }

    [STAThread]
    private static void Main(string[] args)
    {
        _mainThread = GetCurrentThreadId();

        if (Array.IndexOf(args, "--version") >= 0)
        {
            Out("{\"version\":\"" + Version + "\"}");
            return;
        }

        Out("{\"ready\":" + NowMs() + ",\"pid\":" + Process.GetCurrentProcess().Id
            + ",\"version\":\"" + Version + "\"}");

        // A closed stdin is the app going away: exit rather than hold a hook open
        // for a process that no longer supervises us.
        var reader = new Thread(() =>
        {
            string line;
            try
            {
                while ((line = Console.In.ReadLine()) != null) HandleLine(line);
            }
            catch
            {
                // fall through to the quit below
            }
            PostThreadMessage(_mainThread, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
        });
        reader.IsBackground = true;
        reader.Start();

        // WH_MOUSE_LL and SetWinEventHook both need a message loop on this thread.
        MSG msg;
        while (!_stop && GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
        {
            TranslateMessage(ref msg);
            DispatchMessage(ref msg);
        }

        _stop = true;
        _watching = false;
        RemoveMouseHook();
        RemoveFgHook();
        Out("{\"bye\":" + NowMs() + "}");
    }
}
