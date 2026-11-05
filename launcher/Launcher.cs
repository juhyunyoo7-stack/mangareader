// MangaReader desktop launcher (WinForms host, .NET Framework 4, built with the csc.exe that ships
// with Windows; see launcher/BUILD.md). It serves the built app from the "app" folder next to the exe
// on http://localhost:4173 and opens it in an Edge (or Chrome) app window with its own profile.
//
// The port is fixed on purpose: the library (IndexedDB/OPFS) belongs to the origin
// http://localhost:4173, so another port would show an empty library.
//
// Test hooks (environment variables, not needed for normal use):
//   MANGAREADER_PROFILE     use this browser profile folder instead of %LOCALAPPDATA%\MangaReader\profile
//   MANGAREADER_DEBUG_PORT  start the browser with --remote-debugging-port=<n> (automated tests)
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

static class Launcher
{
    const int Port = 4173;
    const string Title = "만화 리더";
    const string MutexName = "MangaReaderLauncher_v1";
    const string PingPath = "/__launcher/ping";
    static readonly string Url = "http://localhost:" + Port + "/";
    static readonly string Token = Guid.NewGuid().ToString("N");

    // ---- static file server ------------------------------------------------------------------

    static string Mime(string p)
    {
        switch (Path.GetExtension(p).ToLowerInvariant())
        {
            case ".html": return "text/html; charset=utf-8";
            case ".js": case ".mjs": return "text/javascript; charset=utf-8";
            case ".css": return "text/css; charset=utf-8";
            case ".json": case ".webmanifest": return "application/json; charset=utf-8";
            case ".wasm": return "application/wasm";
            case ".png": return "image/png";
            case ".svg": return "image/svg+xml";
            case ".ico": return "image/x-icon";
            case ".jpg": case ".jpeg": return "image/jpeg";
            case ".webp": return "image/webp";
            default: return "application/octet-stream";
        }
    }

    static void Serve(HttpListener l, string root)
    {
        string rootSep = root.EndsWith("\\") ? root : root + "\\";
        while (l.IsListening)
        {
            HttpListenerContext c;
            try { c = l.GetContext(); } catch { return; }
            ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    var res = c.Response;
                    if (!c.Request.IsLocal) { res.StatusCode = 403; res.Close(); return; }
                    string path = Uri.UnescapeDataString(c.Request.Url.AbsolutePath);
                    if (path == PingPath)
                    {
                        byte[] t = Encoding.ASCII.GetBytes(Token);
                        res.ContentType = "text/plain";
                        res.ContentLength64 = t.Length;
                        res.OutputStream.Write(t, 0, t.Length);
                        res.Close();
                        return;
                    }
                    string rel = path.TrimStart('/');
                    if (rel.Length == 0) rel = "index.html";
                    string full = Path.GetFullPath(Path.Combine(root, rel.Replace('/', '\\')));
                    if (!full.StartsWith(rootSep, StringComparison.OrdinalIgnoreCase)) { res.StatusCode = 403; res.Close(); return; }
                    if (!File.Exists(full)) full = Path.Combine(root, "index.html"); // SPA fallback
                    byte[] b = File.ReadAllBytes(full);
                    string name = Path.GetFileName(full).ToLowerInvariant();
                    // the shell and the service worker must be revalidated so app updates show up
                    if (name == "index.html" || name == "sw.js" || name == "manifest.webmanifest")
                        res.Headers["Cache-Control"] = "no-cache";
                    res.ContentType = Mime(full);
                    res.ContentLength64 = b.Length;
                    if (c.Request.HttpMethod != "HEAD") res.OutputStream.Write(b, 0, b.Length);
                    res.Close();
                }
                catch { try { c.Response.Abort(); } catch { } }
            });
        }
    }

    /// <summary>True when http://localhost:4173 answers with this process's token.</summary>
    static bool PingSelf()
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(Url.TrimEnd('/') + PingPath);
            req.Timeout = 3000;
            req.Proxy = null;
            using (var r = (HttpWebResponse)req.GetResponse())
            using (var s = new StreamReader(r.GetResponseStream()))
                return s.ReadToEnd().Trim() == Token;
        }
        catch { return false; }
    }

    // ---- browser ----------------------------------------------------------------------------

    static string FindBrowser()
    {
        var c = new List<string>();
        foreach (var key in new[] { "msedge.exe", "chrome.exe" })
        {
            foreach (var hive in new[] { Microsoft.Win32.Registry.CurrentUser, Microsoft.Win32.Registry.LocalMachine })
            {
                try
                {
                    using (var k = hive.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + key))
                        if (k != null && k.GetValue(null) is string) c.Add(((string)k.GetValue(null)).Trim('"'));
                }
                catch { }
            }
            if (key == "msedge.exe")
            {
                c.Add(@"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe");
                c.Add(@"C:\Program Files\Microsoft\Edge\Application\msedge.exe");
            }
            else
            {
                c.Add(@"C:\Program Files\Google\Chrome\Application\chrome.exe");
                c.Add(@"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe");
            }
        }
        foreach (var p in c) if (File.Exists(p)) return p;
        return null;
    }

    /// <summary>Browser processes started with our profile folder.</summary>
    static List<int> ProfileProcesses(string exeName, string profile)
    {
        var ids = new List<int>();
        try
        {
            using (var s = new ManagementObjectSearcher(
                "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='" + exeName + "'"))
                foreach (ManagementObject o in s.Get())
                {
                    var cl = o["CommandLine"] as string;
                    if (cl != null && cl.IndexOf(profile, StringComparison.OrdinalIgnoreCase) >= 0)
                        ids.Add(Convert.ToInt32(o["ProcessId"]));
                }
        }
        catch { }
        return ids;
    }

    // ---- window focus (second launch) -----------------------------------------------------------

    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int pid);

    /// <summary>Brings an open app window of our profile to the front. False when none is open.</summary>
    static bool FocusExisting(string exeName, string profile)
    {
        var ids = new HashSet<int>(ProfileProcesses(exeName, profile));
        if (ids.Count == 0) return false;
        IntPtr found = IntPtr.Zero;
        EnumWindows((h, l) =>
        {
            uint pid;
            GetWindowThreadProcessId(h, out pid);
            if (ids.Contains((int)pid) && IsWindowVisible(h) && GetWindow(h, 4 /*GW_OWNER*/) == IntPtr.Zero
                && GetWindowTextLength(h) > 0)
            {
                found = h;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        if (found == IntPtr.Zero) return false;
        if (IsIconic(found)) ShowWindow(found, 9 /*SW_RESTORE*/);
        BringToFront(found);
        return true;
    }

    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

    /// <summary>
    /// SetForegroundWindow is refused when another program has the focus; attaching to the input of
    /// the current foreground thread for the call is the usual way around that lock.
    /// </summary>
    static void BringToFront(IntPtr h)
    {
        if (SetForegroundWindow(h) && GetForegroundWindow() == h) return;
        uint dummy;
        uint fg = GetWindowThreadProcessId(GetForegroundWindow(), out dummy);
        uint me = GetCurrentThreadId();
        bool attached = fg != 0 && fg != me && AttachThreadInput(me, fg, true);
        try
        {
            BringWindowToTop(h);
            SetForegroundWindow(h);
        }
        finally
        {
            if (attached) AttachThreadInput(me, fg, false);
        }
        if (GetForegroundWindow() != h) SwitchToThisWindow(h, true);
    }

    [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr h, bool altTab);

    static void Error(string msg)
    {
        MessageBox.Show(msg, Title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
    }

    // ---- main -------------------------------------------------------------------------------

    [STAThread]
    static void Main()
    {
        string root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "app"));
        if (!File.Exists(Path.Combine(root, "index.html")))
        {
            Error("프로그램 파일(app 폴더)을 찾을 수 없습니다.\n\n" + root +
                  "\n\nMangaReader.exe 옆에 app 폴더가 함께 있어야 합니다.");
            return;
        }
        string browser = FindBrowser();
        if (browser == null)
        {
            Error("Microsoft Edge 또는 Google Chrome이 필요합니다.\n\nEdge를 설치(또는 복구)한 뒤 다시 실행해 주세요.");
            return;
        }
        string exeName = Path.GetFileName(browser);
        string profile = Environment.GetEnvironmentVariable("MANGAREADER_PROFILE");
        if (string.IsNullOrEmpty(profile))
            profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MangaReader", "profile");
        profile = Path.GetFullPath(profile);

        // Single instance. The mutex lives in a local that is kept alive to the end of Main.
        var mutex = new Mutex(false, MutexName);
        bool owned = false;
        try { owned = mutex.WaitOne(0); } catch (AbandonedMutexException) { owned = true; }
        if (!owned)
        {
            // Already running: bring its window to the front (it may still be opening).
            for (int i = 0; i < 20; i++)
            {
                if (FocusExisting(exeName, profile)) return;
                try { if (mutex.WaitOne(500)) { owned = true; break; } } // the first one is closing
                catch (AbandonedMutexException) { owned = true; break; }
            }
            if (!owned)
            {
                Error("만화 리더가 이미 실행 중이지만 창을 찾지 못했습니다.\n\n잠시 후 다시 실행해 주세요.");
                return;
            }
        }

        HttpListener l = new HttpListener();
        try
        {
            l.Prefixes.Add(Url);
            try { l.Start(); }
            catch (Exception ex)
            {
                // http.sys reports "in use" (32) both for a busy port and for a port inside a range Windows
                // reserved (Hyper-V / WSL / Docker), so ask a plain socket: AccessDenied = reserved by Windows,
                // AddressInUse = another program. (no `when` filter: the compiler shipped with Windows is C# 5)
                bool reserved = false;
                try
                {
                    var probe = new System.Net.Sockets.TcpListener(IPAddress.Loopback, Port);
                    probe.Start();
                    probe.Stop();
                }
                catch (System.Net.Sockets.SocketException se)
                {
                    reserved = se.SocketErrorCode == System.Net.Sockets.SocketError.AccessDenied;
                }
                catch (Exception) { }
                if (reserved)
                {
                    Error("만화 리더를 시작할 수 없습니다.\n\nWindows가 " + Port + "번 포트를 예약해 두었습니다 (다른 프로그램이 쓰는 것이 아닙니다). " +
                          "컴퓨터를 다시 시작하면 보통 풀립니다. 계속 같으면 만화 리더 폴더의 docs\\PORT.md 안내를 따라 주세요.\n\n(만화책 목록이 이 주소에 저장되어 있어 다른 포트로 바꿀 수 없습니다.)");
                    return;
                }
                Error("만화 리더를 시작할 수 없습니다.\n\n이 컴퓨터의 다른 프로그램이 " + Port + "번 포트를 쓰고 있습니다. " +
                      "그 프로그램을 닫은 뒤 다시 실행해 주세요.\n\n(만화책 목록이 이 주소에 저장되어 있어 다른 포트로 바꿀 수 없습니다.)");
                return;
            }
            var t = new Thread(() => Serve(l, root)) { IsBackground = true };
            t.Start();
            // Another program may listen on the same port in a way http.sys does not see
            // (for example a development server bound to 127.0.0.1 only): make sure we are the ones answering.
            if (!PingSelf())
            {
                Error("만화 리더를 시작할 수 없습니다.\n\n" + Port + "번 포트에 다른 프로그램이 응답하고 있습니다. " +
                      "그 프로그램을 닫은 뒤 다시 실행해 주세요.");
                return;
            }

            Directory.CreateDirectory(profile);
            bool firstRun = !File.Exists(Path.Combine(profile, "Local State"));
            string args = "--app=" + Url + " --user-data-dir=\"" + profile + "\" --no-first-run --no-default-browser-check --disable-extensions";
            // the browser remembers the window size and position after the first run
            if (firstRun) args += " --window-size=1100,900";
            string dbg = Environment.GetEnvironmentVariable("MANGAREADER_DEBUG_PORT");
            int dbgPort;
            if (!string.IsNullOrEmpty(dbg) && int.TryParse(dbg, out dbgPort)) args += " --remote-debugging-port=" + dbgPort;
            Process p;
            try { p = Process.Start(new ProcessStartInfo(browser, args) { UseShellExecute = false }); }
            catch (Exception e)
            {
                Error("브라우저를 열 수 없습니다.\n\n" + browser + "\n" + e.Message);
                return;
            }
            if (p != null) { try { AllowSetForegroundWindow(p.Id); } catch { } }

            // Serve until every browser process of our profile has exited (the window was closed).
            // The process we started may hand over to an already running one, so watch the profile.
            Thread.Sleep(3000);
            int misses = 0;
            while (misses < 2) // two empty checks in a row: the browser really has gone
            {
                if (ProfileProcesses(exeName, profile).Count == 0) misses++;
                else misses = 0;
                Thread.Sleep(1500);
            }
        }
        finally
        {
            try { l.Stop(); l.Close(); } catch { }
            if (owned) { try { mutex.ReleaseMutex(); } catch { } }
            GC.KeepAlive(mutex);
        }
    }
}
