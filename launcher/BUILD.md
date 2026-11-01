# Desktop launcher (MangaReader.exe)

`launcher/Launcher.cs` is a small WinForms program (.NET Framework 4, which ships with Windows). It
serves the built app from the `app` folder next to the exe on `http://localhost:4173` and opens it in
an Edge (or Chrome) app window with its own profile (`%LOCALAPPDATA%\MangaReader\profile`). When the
last window of that profile closes, the launcher stops the server and exits.

## Build

```bat
scripts\build-exe.cmd            :: npm run build, mirror dist -> release\app, compile the exe
scripts\build-exe.cmd --no-build :: reuse the current dist
npm run build:exe                :: same as the first line
```

The compile step is:

```bat
%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:winexe /optimize+ /codepage:65001 ^
  /win32icon:launcher\MangaReader.ico /reference:System.Management.dll /reference:System.Windows.Forms.dll ^
  /out:release\MangaReader.exe launcher\Launcher.cs
```

`/codepage:65001` is required: the source is UTF-8 and contains Korean messages. Close the reader
before building (the script refuses while `MangaReader.exe` runs). `release\` is a build output and
is not tracked by git; the Desktop shortcut points to `release\MangaReader.exe`.

## Behaviour

- Port 4173 is fixed on purpose: the library (IndexedDB/OPFS) belongs to the origin
  `http://localhost:4173`. If another program holds the port, a Korean message says so and the
  launcher exits (checked both when http.sys refuses the port and with a token ping to itself).
- Single instance: a second start brings the open window to the front instead of opening another.
  (Windows may refuse to switch focus while a system dialog such as "Windows 보안" is in front.)
- The window size and position are remembered by the browser profile after the first run
  (`--window-size=1100,900` is only passed on the first run).
- `index.html`, `sw.js` and the manifest are served with `Cache-Control: no-cache` so app updates
  are picked up by the service worker.

Test hooks (environment variables): `MANGAREADER_PROFILE` (use another profile folder, e.g. for
tests that must not touch the owner's library) and `MANGAREADER_DEBUG_PORT` (adds
`--remote-debugging-port` so Playwright can drive the window over CDP).

## Icon

`launcher/MangaReader.ico` (256/128/64/48/32/16) and `public/icons/*.png` are made by
`scripts/make-icons.py <master.png>` (Pillow + numpy, e.g. the AIStudio venv). The master was
rendered with the local Stable Diffusion setup (AIStudio, profile "photo", RealVisXL, 1024x1024,
seed 7404, prompt: "3D rendered app icon, glossy plastic and soft clay material, one single object
centered, ... an open manga book with black and white comic panels on its pages and a red bookmark
ribbon, black white and red color scheme, a small red speech bubble floating above the book"),
then a manga panel grid (frames, speed lines, screentone) was drawn onto the cover with a perspective
warp, because none of the 18 generated candidates drew readable comic panels by itself. The master
PNG is not committed (only the final icon files are).
