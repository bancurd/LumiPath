$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $Root ".runtime"
$Node = "C:\Program Files\nodejs\node.exe"

function Test-PortFree($Port) {
  $connection = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -ErrorAction SilentlyContinue
  return $null -eq $connection
}

function Find-FreePort($StartPort) {
  $port = $StartPort
  while (-not (Test-PortFree $port)) {
    $port += 1
  }
  return $port
}

function Start-HiddenProcess {
  param(
    [string]$Command
  )

  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = "cmd.exe"
  $psi.Arguments = "/c $Command"
  $psi.WorkingDirectory = $Root
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $false
  $psi.RedirectStandardError = $false

  $process = [System.Diagnostics.Process]::Start($psi)
  return $process
}

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

$StatePath = Join-Path $RuntimeDir "site.json"
if (Test-Path -LiteralPath $StatePath) {
  & (Join-Path $PSScriptRoot "stop-site.ps1")
}

$apiPort = Find-FreePort 8938
$webPort = Find-FreePort 5317
$apiOut = Join-Path $RuntimeDir "api.out.log"
$apiErr = Join-Path $RuntimeDir "api.err.log"
$webOut = Join-Path $RuntimeDir "web.out.log"
$webErr = Join-Path $RuntimeDir "web.err.log"
Set-Content -LiteralPath $apiOut -Value ""
Set-Content -LiteralPath $apiErr -Value ""
Set-Content -LiteralPath $webOut -Value ""
Set-Content -LiteralPath $webErr -Value ""

$apiCommand = "set LUMIPATH_API_PORT=$apiPort&& set LUMIPATH_WEB_PORT=$webPort&& `"$Node`" `".\node_modules\tsx\dist\cli.mjs`" `"server\index.ts`" > `"$apiOut`" 2> `"$apiErr`""
$webCommand = "set LUMIPATH_API_PORT=$apiPort&& set LUMIPATH_WEB_PORT=$webPort&& `"$Node`" `".\node_modules\vite\bin\vite.js`" --host 127.0.0.1 > `"$webOut`" 2> `"$webErr`""

$api = Start-HiddenProcess $apiCommand
Start-Sleep -Seconds 2
$web = Start-HiddenProcess $webCommand
Start-Sleep -Seconds 3

@{
  apiPid = $api.Id
  webPid = $web.Id
  apiPort = $apiPort
  webPort = $webPort
  url = "http://127.0.0.1:$webPort"
  startedAt = (Get-Date).ToString("s")
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $RuntimeDir "site.json") -Encoding UTF8

Write-Host "LumiPath started"
Write-Host "Web: http://127.0.0.1:$webPort"
Write-Host "API: http://127.0.0.1:$apiPort/api/health"
Write-Host "Stop: stop-lumipath.cmd"
