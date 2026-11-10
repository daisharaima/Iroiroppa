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
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
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

    private static bool IsCsp(string name)
    {
        return name != null && name.IndexOf("ClipStudioPaint", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    private static string ProcessNameOfWindow(IntPtr hWnd)
    {
        if (hWnd == IntPtr.Zero) return string.Empty;
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

    /// True when (x,y) is on CSP's canvas and not on a floating or docked UI surface.
    private static bool IsCanvasAt(int x, int y)
    {
        var point = new POINT { x = x, y = y };
        IntPtr hWnd = WindowFromPoint(point);
        if (hWnd == IntPtr.Zero) return false;
        if (!IsCsp(ProcessNameOfWindow(hWnd))) return false;

        var cls = new StringBuilder(256);
        GetClassName(hWnd, cls, 256);
        if (!CanvasClass.IsMatch(cls.ToString())) return false;

        IntPtr root = GetAncestor(hWnd, GA_ROOT);
        if (root == IntPtr.Zero || root == hWnd) return false;
        var rootCls = new StringBuilder(256);
        GetClassName(root, rootCls, 256);
        if (!RootClass.IsMatch(rootCls.ToString())) return false;

        // Canvas children have no title; palette windows do.
        var title = new StringBuilder(256);
        if (GetWindowText(hWnd, title, 256) > 0) return false;

        // A docked panel can be a child too; the canvas is the large view.
        RECT child, rootRect;
        if (!GetWindowRect(hWnd, out child) || !GetWindowRect(root, out rootRect)) return false;
        long childArea = (long)(child.Right - child.Left) * (child.Bottom - child.Top);
        long rootArea = (long)(rootRect.Right - rootRect.Left) * (rootRect.Bottom - rootRect.Top);
        return childArea > 0 && rootArea > 0 && childArea * 4 >= rootArea;
    }

    private static bool KeyDown(int vk)
    {
        return (GetAsyncKeyState(vk) & 0x8000) != 0;
    }

    // --- hooks -------------------------------------------------------------
    private const int WH_MOUSE_LL = 14;
    private const int WM_MOUSEMOVE = 0x0200;
    private const int WM_LBUTTONDOWN = 0x0201;
    private const int WM_LBUTTONUP = 0x0202;
    private const uint WM_QUIT = 0x0012;
    private const uint WM_APP_COMMAND = 0x8001;
    private const uint PM_NOREMOVE = 0x0000;
    private const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
    private const uint WINEVENT_OUTOFCONTEXT = 0x0000;
    private const uint WINEVENT_SKIPOWNPROCESS = 0x0002;

    // --- process access ----------------------------------------------------
    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

    // --- bare-key hook (ported from bare-keys.ps1) --------------------------
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;
    private const int VK_LWIN = 0x5B;
    private const int VK_RWIN = 0x5C;
    private const int IDC_IBEAM = 32513;
    private const uint GA_ROOT_KEYBOARD = 2;

    private static IntPtr _keyHook = IntPtr.Zero;
    private static HookProc _keyProc;

    /// One entry per binding: the key it watches and the state main pushed down.
    private sealed class KeyBinding
    {
        public int Vk;
        public bool Active = true;
        public bool Typing;
        /// Only claim the key while the pointer is over CSP's canvas (drawn-on area),
        /// so a bare letter cannot fire while the cursor rests on a text field.
        public bool Canvas;
        /// CSP reports that it would refuse a Quick Access command right now (a text layer,
        /// any non-brush tool, or a stroke in progress), so a bare key must pass through.
        public bool Busy;
        /// Report the key but never swallow it: the app below still receives it, so a
        /// misfire can never eat a keystroke. Defaults to true: a binding that forgets
        /// to say otherwise must not be able to lose a key.
        public bool Observe = true;
        public bool Claimed;
    }

    private static readonly Dictionary<int, KeyBinding> _bindings = new Dictionary<int, KeyBinding>();

    // --- the CSP canvas test (ported from pointer.ps1) ----------------------
    private const uint GA_ROOT = 2;
    private const int VK_MENU = 0x12;
    private const int VK_CONTROL = 0x11;
    private const int VK_SHIFT = 0x10;

    /// A CSP canvas child carries two GUIDs in its class name; a floating panel shares
    /// that shape, which is why the root class and the title are checked too.
    private static readonly Regex CanvasClass = new Regex(
        "^[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}-[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex RootClass = new Regex(
        "^[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);
    private delegate void WinEventProc(IntPtr hWinEventHook, uint eventType, IntPtr hwnd,
        int idObject, int idChild, uint dwEventThread, uint dwmsEventTime);

    [StructLayout(LayoutKind.Sequential)]
    private struct KBDLLHOOKSTRUCT
    {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

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
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct GUITHREADINFO
    {
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
    private struct CURSORINFO
    {
        public uint cbSize;
        public uint flags;
        public IntPtr hCursor;
        public POINT ptScreenPos;
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
    [DllImport("user32.dll")]
    private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")]
    private static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll")]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder name, int max);
    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
    [DllImport("user32.dll")]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")]
    private static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO info);
    [DllImport("user32.dll")]
    private static extern bool GetCursorInfo(ref CURSORINFO info);
    [DllImport("user32.dll")]
    private static extern IntPtr LoadCursor(IntPtr instance, IntPtr name);
    [DllImport("imm32.dll")]
    private static extern IntPtr ImmGetContext(IntPtr hWnd);
    [DllImport("imm32.dll")]
    private static extern bool ImmGetOpenStatus(IntPtr himc);
    [DllImport("imm32.dll")]
    private static extern bool ImmReleaseContext(IntPtr hWnd, IntPtr himc);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll")]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    private const uint SYNCHRONIZE = 0x00100000;
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

    /// Emit every press, whatever the app under the pointer (diagnostics only).
    private static volatile bool _probe;

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

    /// Commands run on the message-loop thread: WH_MOUSE_LL and SetWinEventHook only
    /// deliver to the thread that installed them, and that thread must pump messages.
    private static readonly Queue<string> _commands = new Queue<string>();

    [DllImport("user32.dll")]
    private static extern bool PeekMessage(out MSG msg, IntPtr hWnd, uint min, uint max, uint remove);

    private static void DrainCommands()
    {
        while (true)
        {
            string line = null;
            lock (_commands)
            {
                if (_commands.Count == 0) break;
                line = _commands.Dequeue();
            }
            if (line != null) HandleLine(line);
        }
    }

    /// Hook callbacks must never block: a full pipe or a stalled parent would hold the
    /// hook past its budget and Windows silently removes it. They enqueue; one writer
    /// thread owns every byte on stdout.
    private static readonly System.Collections.Concurrent.ConcurrentQueue<string> _outQueue =
        new System.Collections.Concurrent.ConcurrentQueue<string>();
    private static readonly System.Threading.AutoResetEvent _outReady =
        new System.Threading.AutoResetEvent(false);
    private static Thread _writerThread;

    private static void Enqueue(string line)
    {
        _outQueue.Enqueue(line);
        try { _outReady.Set(); } catch { /* shutting down */ }
    }

    private static void StartWriter()
    {
        if (_writerThread != null) return;
        _writerThread = new Thread(() =>
        {
            while (!_stop || !_outQueue.IsEmpty)
            {
                _outReady.WaitOne(200);
                string line;
                while (_outQueue.TryDequeue(out line)) Out(line);
            }
        });
        _writerThread.IsBackground = true;
        _writerThread.Start();
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

                    // Only presses over Clip Studio Paint matter to the pick history; a
                    // click anywhere else would be noise the app has to filter.
                    string name = ProcessNameOfWindow(WindowFromPoint(new POINT { x = data.x, y = data.y }));
                    if (_probe || IsCsp(name))
                    {
                        if (msg == WM_LBUTTONDOWN)
                        {
                            Enqueue("{\"mouse\":\"down\",\"canvas\":" + (IsCanvasAt(data.x, data.y) ? "true" : "false")
                                + ",\"alt\":" + (KeyDown(VK_MENU) ? "true" : "false")
                                + ",\"ctrl\":" + (KeyDown(VK_CONTROL) ? "true" : "false")
                                + ",\"shift\":" + (KeyDown(VK_SHIFT) ? "true" : "false")
                                + ",\"x\":" + data.x + ",\"y\":" + data.y
                                + ",\"process\":\"" + Escape(name) + "\",\"t\":" + NowMs() + "}");
                        }
                        else
                        {
                            Enqueue("{\"mouse\":\"up\",\"x\":" + data.x + ",\"y\":" + data.y
                                + ",\"process\":\"" + Escape(name) + "\",\"t\":" + NowMs() + "}");
                        }
                    }
                }
                catch
                {
                    // A malformed callback must never break the hook chain.
                }
            }
        }
        return CallNextHookEx(_mouseHook, nCode, wParam, lParam);
    }

    /// True when the user is typing somewhere the app must not interrupt: a dialog, a
    /// caret, an open IME, or an I-beam cursor. Ported from bare-keys.ps1 — a wrong
    /// answer here swallows the user's keystrokes.
    private static bool NativeTyping()
    {
        IntPtr fg = GetForegroundWindow();
        if (fg == IntPtr.Zero) return false;

        var cls = new StringBuilder(256);
        GetClassName(fg, cls, 256);
        if (cls.ToString() == "#32770") return true;   // a dialog box

        uint pid;
        uint thread = GetWindowThreadProcessId(fg, out pid);
        var gui = new GUITHREADINFO();
        gui.cbSize = (uint)Marshal.SizeOf(typeof(GUITHREADINFO));
        if (thread != 0 && GetGUIThreadInfo(thread, ref gui))
        {
            if (gui.hwndCaret != IntPtr.Zero) return true;
            if ((gui.flags & 1) != 0) return true;     // GUI_CARETBLINKING
        }

        IntPtr ime = ImmGetContext(fg);
        if (ime != IntPtr.Zero)
        {
            bool open = ImmGetOpenStatus(ime);
            ImmReleaseContext(fg, ime);
            if (open) return true;
        }

        var cursor = new CURSORINFO();
        cursor.cbSize = (uint)Marshal.SizeOf(typeof(CURSORINFO));
        if (GetCursorInfo(ref cursor) && cursor.hCursor != IntPtr.Zero)
        {
            IntPtr ibeam = LoadCursor(IntPtr.Zero, (IntPtr)IDC_IBEAM);
            if (ibeam != IntPtr.Zero && cursor.hCursor == ibeam) return true;
        }
        return false;
    }

    /// True when the pointer is over CSP's canvas right now (see IsCanvasAt).
    private static bool CanvasUnderCursor()
    {
        POINT p;
        if (!GetCursorPos(out p)) return false;
        return IsCanvasAt(p.x, p.y);
    }

    /// Every signal NativeTyping() looks at, reported separately. A single "typing=1"
    /// cannot say WHICH check fired, and with a host that paints its own UI (CSP) that
    /// is the only way to learn whether it is detected at all.
    private static void ReportTypingSignals()
    {
        IntPtr fg = GetForegroundWindow();
        if (fg == IntPtr.Zero) { Out("{\"typing\":0,\"why\":\"no-foreground\"}"); return; }

        var cls = new StringBuilder(256);
        GetClassName(fg, cls, 256);
        string className = cls.ToString();
        bool dialog = className == "#32770";

        uint pid;
        uint thread = GetWindowThreadProcessId(fg, out pid);
        bool caret = false, blink = false;
        var gui = new GUITHREADINFO();
        gui.cbSize = (uint)Marshal.SizeOf(typeof(GUITHREADINFO));
        if (thread != 0 && GetGUIThreadInfo(thread, ref gui))
        {
            caret = gui.hwndCaret != IntPtr.Zero;
            blink = (gui.flags & 1) != 0;
        }

        bool ime = false;
        IntPtr ctxIme = ImmGetContext(fg);
        if (ctxIme != IntPtr.Zero)
        {
            ime = ImmGetOpenStatus(ctxIme);
            ImmReleaseContext(fg, ctxIme);
        }

        bool ibeam = false;
        long cursorHandle = 0;
        var cursor = new CURSORINFO();
        cursor.cbSize = (uint)Marshal.SizeOf(typeof(CURSORINFO));
        if (GetCursorInfo(ref cursor) && cursor.hCursor != IntPtr.Zero)
        {
            cursorHandle = cursor.hCursor.ToInt64();
            IntPtr beam = LoadCursor(IntPtr.Zero, (IntPtr)IDC_IBEAM);
            ibeam = beam != IntPtr.Zero && cursor.hCursor == beam;
        }

        Out("{\"typing\":1"
            + ",\"fg\":\"" + Escape(ProcessNameOfWindow(fg)) + "\""
            + ",\"cls\":\"" + Escape(className) + "\""
            + ",\"dialog\":" + (dialog ? 1 : 0)
            + ",\"caret\":" + (caret ? 1 : 0)
            + ",\"blink\":" + (blink ? 1 : 0)
            + ",\"ime\":" + (ime ? 1 : 0)
            + ",\"ibeam\":" + (ibeam ? 1 : 0)
            + ",\"cursor\":\"0x" + cursorHandle.ToString("x") + "\""
            + ",\"result\":" + (NativeTyping() ? 1 : 0)
            + ",\"t\":" + NowMs() + "}");
    }

    /// A modifier held means the user is doing something else (Ctrl+S, not a bare key).
    private static bool ModifierDown()
    {
        return KeyDown(VK_CONTROL) || KeyDown(VK_SHIFT) || KeyDown(VK_MENU)
            || KeyDown(VK_LWIN) || KeyDown(VK_RWIN);
    }

    /// The callback only reads the struct and writes one line when a registered bare key
    /// changes state; everything it decides from is pushed down by the app.
    private static IntPtr KeyCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            try
            {
                var info = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                KeyBinding binding;
                if (_bindings.TryGetValue((int)info.vkCode, out binding))
                {
                    int message = wParam.ToInt32();
                    bool down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
                    bool up = message == WM_KEYUP || message == WM_SYSKEYUP;

                    if (down)
                    {
                        if (binding.Claimed) return binding.Observe ? CallNextHookEx(_keyHook, nCode, wParam, lParam) : (IntPtr)1;
                        if (binding.Active && !binding.Typing && !binding.Busy && !ModifierDown()
                            && !NativeTyping() && (!binding.Canvas || CanvasUnderCursor()))
                        {
                            binding.Claimed = true;
                            Enqueue("{\"key\":\"down\",\"vk\":" + info.vkCode + ",\"t\":" + NowMs() + "}");
                            // Observer mode: the app underneath still gets the key.
                            if (binding.Observe) return CallNextHookEx(_keyHook, nCode, wParam, lParam);
                            return (IntPtr)1;                        // swallow it
                        }
                    }
                    else if (up && binding.Claimed)
                    {
                        binding.Claimed = false;
                        Enqueue("{\"key\":\"up\",\"vk\":" + info.vkCode + ",\"t\":" + NowMs() + "}");
                        if (binding.Observe) return CallNextHookEx(_keyHook, nCode, wParam, lParam);
                        return (IntPtr)1;
                    }
                }
            }
            catch
            {
                // A malformed callback must never break the hook chain.
            }
        }
        return CallNextHookEx(_keyHook, nCode, wParam, lParam);
    }

    private static bool EnsureKeyboardHook()
    {
        if (_keyHook != IntPtr.Zero) return true;
        _keyProc = KeyCallback;
        _keyHook = SetWindowsHookEx(WH_KEYBOARD_LL, _keyProc, IntPtr.Zero, 0);
        Out("{\"keyhook\":" + (_keyHook != IntPtr.Zero ? 1 : 0) + ",\"t\":" + NowMs() + "}");
        return _keyHook != IntPtr.Zero;
    }

    private static void RemoveKeyboardHookIfUnused()
    {
        if (_keyHook == IntPtr.Zero || _bindings.Count > 0) return;
        UnhookWindowsHookEx(_keyHook);
        _keyHook = IntPtr.Zero;
        Out("{\"keyhook\":0,\"t\":" + NowMs() + "}");
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

        Enqueue("{\"fg\":\"" + Escape(name) + "\",\"hwnd\":" + hWnd.ToInt64() + ",\"t\":" + NowMs() + "}");
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
        Out("{\"fgon\":1,\"hook\":" + (_fgHook != IntPtr.Zero ? 1 : 0) + ",\"t\":" + NowMs() + "}");
        // Report the current foreground once so the app does not wait for a switch.
        EmitForeground();
    }

    private static void RemoveFgHook()
    {
        if (_fgHook == IntPtr.Zero) return;
        UnhookWinEvent(_fgHook);
        _fgHook = IntPtr.Zero;
        Out("{\"fgon\":0,\"t\":" + NowMs() + "}");
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
        string line = (raw ?? string.Empty).Trim().TrimStart('\uFEFF');
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

            case "typing":
                // Diagnostic: which typing signal (if any) sees the foreground window.
                ReportTypingSignals();
                break;

            case "sendkey":
                {
                    // Diagnostic: inject one keystroke. Spawning a helper process to do it
                    // steals the foreground, which is exactly what these probes measure.
                    int vk = ParseInt(arg.Trim(), 0);
                    keybd_event((byte)vk, 0, 0, UIntPtr.Zero);
                    keybd_event((byte)vk, 0, 2, UIntPtr.Zero);
                    Out("{\"sent\":" + vk + ",\"t\":" + NowMs() + "}");
                }
                break;

            case "move":
                {
                    // Diagnostic: put the pointer somewhere, for the bare-key canvas probe.
                    string[] parts = arg.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length < 2) { Fail("move needs x y"); break; }
                    int mx = ParseInt(parts[0], 0);
                    int my = ParseInt(parts[1], 0);
                    bool moved = SetCursorPos(mx, my);
                    Out("{\"moved\":" + (moved ? 1 : 0) + ",\"x\":" + mx + ",\"y\":" + my + "}");
                }
                break;

            case "cursor":
                {
                    // Diagnostic: where is the pointer, and is it over CSP's canvas?
                    // Used by the bare-key probe, which must attribute each claimed press
                    // to the pointer's position at that moment.
                    POINT cp;
                    if (!GetCursorPos(out cp)) { Fail("could not read the cursor"); break; }
                    string cname = ProcessNameOfWindow(WindowFromPoint(new POINT { x = cp.x, y = cp.y }));
                    Out("{\"cursor\":1,\"x\":" + cp.x + ",\"y\":" + cp.y
                        + ",\"process\":\"" + Escape(cname) + "\""
                        + ",\"csp\":" + (IsCsp(cname) ? "true" : "false")
                        + ",\"canvas\":" + (IsCanvasAt(cp.x, cp.y) ? "true" : "false")
                        + ",\"t\":" + NowMs() + "}");
                }
                break;

            case "hit":
                {
                    // Diagnostic: report what a press at (x,y) would be, without pressing.
                    string[] parts = arg.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length < 2) { Fail("hit needs x y"); break; }
                    int hx = ParseInt(parts[0], 0);
                    int hy = ParseInt(parts[1], 0);
                    string hname = ProcessNameOfWindow(WindowFromPoint(new POINT { x = hx, y = hy }));
                    Out("{\"hit\":1,\"x\":" + hx + ",\"y\":" + hy
                        + ",\"process\":\"" + Escape(hname) + "\""
                        + ",\"csp\":" + (IsCsp(hname) ? "true" : "false")
                        + ",\"canvas\":" + (IsCanvasAt(hx, hy) ? "true" : "false")
                        + ",\"t\":" + NowMs() + "}");
                }
                break;

            case "key":
                {
                    // key <vk> [active] [typing] [canvas]   -> register a bare-key binding
                    string[] parts = arg.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length == 0) { Fail("key needs a vk"); break; }

                    int vk = ParseInt(parts[0], 0);
                    if (vk <= 0) { Fail("key needs a valid vk"); break; }

                    KeyBinding binding;
                    if (!_bindings.TryGetValue(vk, out binding))
                    {
                        binding = new KeyBinding { Vk = vk };
                        _bindings[vk] = binding;
                    }
                    if (parts.Length > 1) binding.Active = parts[1] != "0";
                    if (parts.Length > 2) binding.Typing = parts[2] != "0";
                    if (parts.Length > 3) binding.Canvas = parts[3] != "0";

                    if (!EnsureKeyboardHook())
                    {
                        Out("{\"keyadd\":0,\"vk\":" + vk + ",\"error\":\"hook-failed\"}");
                        break;
                    }
                    Out("{\"keyadd\":1,\"vk\":" + vk + ",\"active\":" + (binding.Active ? 1 : 0) + "}");
                }
                break;

            case "keyoff":
                {
                    string[] parts = arg.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length == 0) { _bindings.Clear(); RemoveKeyboardHookIfUnused(); Out("{\"keydel\":1,\"keys\":0}"); break; }
                    int vk = ParseInt(parts[0], 0);
                    _bindings.Remove(vk);
                    RemoveKeyboardHookIfUnused();
                    Out("{\"keydel\":1,\"vk\":" + vk + ",\"keys\":" + _bindings.Count + "}");
                }
                break;

            case "keyactive":
            case "keytyping":
            case "keycanvas":
            case "keybusy":
            case "keyobserve":
                {
                    string[] parts = arg.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length < 2) { Fail(cmd + " needs vk and 0|1"); break; }
                    int vk = ParseInt(parts[0], 0);
                    KeyBinding binding;
                    if (!_bindings.TryGetValue(vk, out binding)) { Fail("unknown vk"); break; }
                    bool value = parts[1] != "0";
                    if (cmd == "keyactive") binding.Active = value;
                    else if (cmd == "keycanvas") binding.Canvas = value;
                    else if (cmd == "keybusy") binding.Busy = value;
                    else if (cmd == "keyobserve") binding.Observe = value;
                    else binding.Typing = value;
                    Out("{\"" + cmd + "\":" + (value ? 1 : 0) + ",\"vk\":" + vk + "}");
                }
                break;

            case "probe":
                _probe = arg != "0";
                Out("{\"probe\":" + (_probe ? 1 : 0) + "}");
                break;

            case "mouse":
                _mouseOn = arg != "0";
                if (_mouseOn) InstallMouseHook(); else RemoveMouseHook();
                Out("{\"mouseon\":" + (_mouseOn ? 1 : 0) + "}");
                break;

            case "foreground":
                {
                    IntPtr fgWnd = GetForegroundWindow();
                    string fgName = fgWnd == IntPtr.Zero ? string.Empty : ForegroundName(fgWnd);
                    Out("{\"fgname\":\"" + Escape(fgName) + "\",\"hwnd\":" + fgWnd.ToInt64() + ",\"t\":" + NowMs() + "}");
                }
                break;

            case "fg":
                _fgOn = arg != "0";
                if (_fgOn) InstallFgHook(); else RemoveFgHook();
                Out("{\"fgon\":" + (_fgOn ? 1 : 0) + "}");
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
        if (int.TryParse(text, out value)) return value;
        if (!string.IsNullOrEmpty(text) && text.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
        {
            int hex;
            if (int.TryParse(text.Substring(2), System.Globalization.NumberStyles.HexNumber, null, out hex)) return hex;
        }
        return fallback;
    }

    /// Watch the parent process directly. Waiting on stdin EOF alone misses the cases
    /// where a child elsewhere inherited the pipe, or the reader thread ends while the
    /// message loop (which owns the hooks) keeps running.
    private static void WatchParent(int parentPid)
    {
        if (parentPid <= 0) return;
        IntPtr handle = OpenProcess(SYNCHRONIZE, false, (uint)parentPid);
        if (handle == IntPtr.Zero)
        {
            // Already gone, or not ours to watch: the stdin path still covers us.
            return;
        }
        var thread = new Thread(() =>
        {
            WaitForSingleObject(handle, 0xFFFFFFFF);
            _stop = true;
            PostThreadMessage(_mainThread, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
        });
        thread.IsBackground = true;
        thread.Start();
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

        StartWriter();

        // --parent <pid>: exit when the app does, whatever happens to the pipe.
        int parentIndex = Array.IndexOf(args, "--parent");
        if (parentIndex >= 0 && parentIndex + 1 < args.Length)
        {
            int parentPid;
            if (int.TryParse(args[parentIndex + 1], out parentPid)) WatchParent(parentPid);
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
                while ((line = Console.In.ReadLine()) != null)
                {
                    lock (_commands) { _commands.Enqueue(line); }
                    PostThreadMessage(_mainThread, WM_APP_COMMAND, IntPtr.Zero, IntPtr.Zero);
                }
            }
            catch
            {
                // fall through to the quit below
            }
            PostThreadMessage(_mainThread, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
        });
        reader.IsBackground = true;
        reader.Start();

        // Create this thread's message queue *before* the reader can post to it.
        MSG msg;
        PeekMessage(out msg, IntPtr.Zero, 0, 0, PM_NOREMOVE);

        // WH_MOUSE_LL and SetWinEventHook both need a message loop on this thread.
        while (!_stop && GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
        {
            if (msg.message == WM_APP_COMMAND)
            {
                DrainCommands();
                continue;
            }
            TranslateMessage(ref msg);
            DispatchMessage(ref msg);
        }

        _stop = true;
        _watching = false;
        try { _outReady.Set(); } catch { /* already gone */ }
        RemoveMouseHook();
        RemoveFgHook();
        Out("{\"bye\":" + NowMs() + "}");
    }
}
