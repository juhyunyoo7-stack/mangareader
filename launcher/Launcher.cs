using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;

static class Launcher
{
    const int Port = 4173;
    static readonly string Url = "http://localhost:" + Port + "/";

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
        while (l.IsListening)
        {
            HttpListenerContext c;
            try { c = l.GetContext(); } catch { return; }
            ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    string rel = Uri.UnescapeDataString(c.Request.Url.AbsolutePath).TrimStart('/');
                    if (rel.Length == 0) rel = "index.html";
                    string full = Path.GetFullPath(Path.Combine(root, rel.Replace('/', Path.DirectorySeparatorChar)));
                    if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase)) { c.Response.StatusCode = 403; c.Response.Close(); return; }
                    if (!File.Exists(full)) full = Path.Combine(root, "index.html");
                    byte[] b = File.ReadAllBytes(full);
                    c.Response.ContentType = Mime(full);
                    c.Response.ContentLength64 = b.Length;
                    c.Response.OutputStream.Write(b, 0, b.Length);
                    c.Response.Close();
                }
                catch { try { c.Response.Abort(); } catch { } }
            });
        }
    }

    static string FindEdge()
    {
        string[] c = {
            @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            @"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            @"C:\Program Files\Google\Chrome\Application\chrome.exe",
            @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" };
        foreach (var p in c) if (File.Exists(p)) return p;
        return null;
    }

    [STAThread]
    static void Main()
    {
        string root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "app"));
        if (!File.Exists(Path.Combine(root, "index.html")))
        { MessageBox.Show("app 폴더(index.html)를 찾을 수 없습니다:\n" + root, "만화책"); return; }
        string browser = FindEdge();
        if (browser == null)
        { MessageBox.Show("Edge 또는 Chrome이 필요합니다.", "만화책"); return; }

        bool created;
        var mutex = new Mutex(true, "MangaReaderLauncher_v1", out created);
        HttpListener l = null;
        if (created)
        {
            l = new HttpListener();
            l.Prefixes.Add(Url);
            try { l.Start(); }
            catch { MessageBox.Show("포트 " + Port + "를 열 수 없습니다. 다른 프로그램이 사용 중일 수 있습니다.", "만화책"); return; }
            var t = new Thread(() => Serve(l, root)) { IsBackground = true };
            t.Start();
        }

        string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MangaReader", "profile");
        Directory.CreateDirectory(profile);
        var psi = new ProcessStartInfo(browser,
            "--app=" + Url + " --user-data-dir=\"" + profile + "\" --no-first-run --no-default-browser-check --window-size=1100,900")
        { UseShellExecute = false };
        var p = Process.Start(psi);
        if (!created) return; // 2nd launch: server already owned by first instance
        // wait until the dedicated-profile browser fully exits
        Thread.Sleep(3000);
        while (true)
        {
            bool alive = false;
            foreach (var pr in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(browser)))
            {
                try
                {
                    using (var s = new System.Management.ManagementObjectSearcher("SELECT CommandLine FROM Win32_Process WHERE ProcessId=" + pr.Id))
                        foreach (System.Management.ManagementObject o in s.Get())
                        { var cl = o["CommandLine"] as string; if (cl != null && cl.IndexOf("MangaReader" + Path.DirectorySeparatorChar + "profile", StringComparison.OrdinalIgnoreCase) >= 0) alive = true; }
                }
                catch { }
                if (alive) break;
            }
            if (!alive) break;
            Thread.Sleep(2000);
        }
        l.Stop();
    }
}
