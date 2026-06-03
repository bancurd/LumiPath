$ErrorActionPreference = "SilentlyContinue"

$Root = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $Root ".runtime"
$StatePath = Join-Path $RuntimeDir "site.json"

if (Test-Path -LiteralPath $StatePath) {
  $state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
  foreach ($processId in @($state.apiPid, $state.webPid)) {
    if ($processId) {
      Stop-Process -Id $processId -Force
    }
  }
  foreach ($port in @($state.apiPort, $state.webPort)) {
    if ($port) {
      try {
        Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $port -ErrorAction SilentlyContinue |
          Select-Object -ExpandProperty OwningProcess -Unique |
          ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
      } catch {
      }

      netstat -ano |
        Select-String "127\.0\.0\.1:$port\s+.*LISTENING\s+(\d+)" |
        ForEach-Object {
          $processId = [int]$_.Matches[0].Groups[1].Value
          Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        }
    }
  }
  Remove-Item -LiteralPath $StatePath -Force
  Write-Host "LumiPath stopped"
} else {
  Write-Host "No LumiPath runtime record found."
}
