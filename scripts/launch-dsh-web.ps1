# DeepSeek Harness desktop launcher (invoked hidden from the desktop shortcut).
#
#   * If `dsh web` is already running on the port, spawn a second Electron
#     instance; the single-instance lock makes it exit and the running window
#     is shown/focused (second-instance handler).
#   * Otherwise start `dsh web` hidden (via launch-dsh-web.cmd) and wait for
#     the port to come up; on timeout show the tail of the web log.
#
# Edit the paths below if the project or home moves.
param(
  [int]$Port = 3080
)

$ErrorActionPreference = "Stop"
$HomeDir = "C:\Users\XHDN\.dsh"
# Derive the project root from this script's own location instead of a
# hardcoded path: PS 5.1 reads .ps1 files without a UTF-8 BOM as ANSI, which
# would garble a Chinese literal like "E:\dsh插件\..." and break every path.
$Project = Split-Path -Parent $PSScriptRoot
$Url = "http://127.0.0.1:$Port"
$LauncherLog = Join-Path $HomeDir "desktop-shell-launcher.log"
$WebLog = Join-Path $HomeDir "desktop-shell-web.log"

Add-Type -AssemblyName System.Windows.Forms

function Write-Log([string]$msg) {
  try {
    Add-Content -Path $LauncherLog -Value ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg) -Encoding UTF8
  } catch { }
}

function Test-PortOpen([int]$p) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $iar = $c.BeginConnect("127.0.0.1", $p, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(1200, $false)
    if ($ok) { $c.EndConnect($iar) }
    $c.Close()
    return $ok
  } catch { return $false }
}

# First probe, then a second opinion: a dsh web that is mid-boot (or a peer
# shortcut/terminal launch) can make the first probe miss, which would start a
# duplicate instance that then dies with EADDRINUSE.
$portOpen = Test-PortOpen $Port
if (-not $portOpen) {
  Start-Sleep -Milliseconds 2000
  $portOpen = Test-PortOpen $Port
}

if ($portOpen) {
  Write-Log "already running at $Url - focusing window"
  $exe = Join-Path $Project "node_modules\electron\dist\electron.exe"
  $main = Join-Path $Project "lib\electron-main.cjs"
  if ((Test-Path $exe) -and (Test-Path $main)) {
    Start-Process -FilePath $exe -ArgumentList @($main, "--url", $Url)
  } else {
    Write-Log "electron not found; cannot focus"
    [System.Windows.Forms.MessageBox]::Show(
      "dsh 已在运行(端口 $Port),但找不到 Electron 来唤起窗口。`n$exe",
      "DeepSeek Harness") | Out-Null
  }
  exit 0
}

Write-Log "starting dsh web on port $Port"
Start-Process -FilePath (Join-Path $Project "scripts\launch-dsh-web.cmd") -WindowStyle Hidden | Out-Null

# Give a heavy profile (many bundles) time to boot; also cover the race where a
# peer instance grabs the port mid-boot — the poll accepts whoever binds it.
$deadline = (Get-Date).AddSeconds(60)
$up = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 800
  if (Test-PortOpen $Port) { $up = $true; break }
}

if ($up) {
  Write-Log "dsh web is up at $Url"
} else {
  Write-Log "TIMEOUT - dsh web did not bind port $Port"
  $tail = ""
  if (Test-Path $WebLog) { $tail = (Get-Content $WebLog -Tail 15) -join "`n" }
  [System.Windows.Forms.MessageBox]::Show(
    "dsh web 未能在端口 $Port 启动(60 秒超时)。`n`n最后输出:`n$tail",
    "DeepSeek Harness 启动失败") | Out-Null
}
