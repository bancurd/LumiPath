$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $Root ".runtime"
$Node = "C:\Program Files\nodejs\node.exe"
$PythonCandidates = @(
  $env:LUMIPATH_PYTHON,
  (Join-Path $Root ".venv\Scripts\python.exe"),
  "C:\ProgramData\miniconda3\python.exe",
  (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe")
) | Where-Object { $_ }
$Python = $PythonCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

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

if (-not $Python) {
  throw "Python runtime not found. Set LUMIPATH_PYTHON to a Python executable, or install Miniconda at C:\ProgramData\miniconda3."
}

& $Python -c "import fastapi, uvicorn" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Installing Python backend dependencies from requirements.txt..."
  & $Python -m pip install -r (Join-Path $Root "requirements.txt")
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to install Python backend dependencies. Run: `"$Python`" -m pip install -r requirements.txt"
  }
}

$StatePath = Join-Path $RuntimeDir "site.json"
if (Test-Path -LiteralPath $StatePath) {
  & (Join-Path $PSScriptRoot "stop-site.ps1")
}

$apiPort = Find-FreePort 8938
$webPort = Find-FreePort 5317
$logStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$apiOut = Join-Path $RuntimeDir "api-$logStamp.out.log"
$apiErr = Join-Path $RuntimeDir "api-$logStamp.err.log"
$webOut = Join-Path $RuntimeDir "web-$logStamp.out.log"
$webErr = Join-Path $RuntimeDir "web-$logStamp.err.log"

$apiCommand = "set LUMIPATH_API_PORT=$apiPort&& set LUMIPATH_WEB_PORT=$webPort&& `"$Python`" -m uvicorn server.main:app --host 127.0.0.1 --port $apiPort > `"$apiOut`" 2> `"$apiErr`""
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
  apiOut = $apiOut
  apiErr = $apiErr
  webOut = $webOut
  webErr = $webErr
  url = "http://127.0.0.1:$webPort"
  startedAt = (Get-Date).ToString("s")
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $RuntimeDir "site.json") -Encoding UTF8

Write-Host "LumiPath started"
Write-Host "Web: http://127.0.0.1:$webPort"
Write-Host "API: http://127.0.0.1:$apiPort/api/health"
Write-Host "Stop: stop-lumipath.cmd"
