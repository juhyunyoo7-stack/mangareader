@echo off
rem Builds the desktop launcher: release\MangaReader.exe + release\app (copy of dist).
rem Usage: scripts\build-exe.cmd            (npm run build, copy dist, compile the exe)
rem        scripts\build-exe.cmd --no-build (reuse the existing dist folder)
rem Needs only Node/npm and the C# compiler that ships with Windows (.NET Framework 4).
setlocal
cd /d "%~dp0.."

tasklist /fi "imagename eq MangaReader.exe" 2>nul | "%SystemRoot%\System32\find.exe" /i "MangaReader.exe" >nul
if not errorlevel 1 (
  echo MangaReader.exe is running. Close the reader window first, then run this again.
  exit /b 1
)

if /i not "%~1"=="--no-build" (
  call npm run build
  if errorlevel 1 exit /b 1
)
if not exist dist\index.html (
  echo dist\index.html is missing. Run without --no-build.
  exit /b 1
)

set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo C# compiler not found: %CSC%
  exit /b 1
)

if not exist release mkdir release
robocopy dist release\app /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo Copying dist to release\app failed.
  exit /b 1
)

set "ICON="
if exist launcher\MangaReader.ico set "ICON=/win32icon:launcher\MangaReader.ico"
"%CSC%" /nologo /target:winexe /optimize+ /codepage:65001 %ICON% /reference:System.Management.dll /reference:System.Windows.Forms.dll /out:release\MangaReader.exe launcher\Launcher.cs
if errorlevel 1 exit /b 1
copy /y launcher\MangaReader.ico release\MangaReader.ico >nul 2>nul
echo Built release\MangaReader.exe (app files: release\app)
exit /b 0
