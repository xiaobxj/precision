param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$port = 4311
$address = "http://127.0.0.1:$port"
$healthy = $false
try {
    $health = Invoke-RestMethod -Uri "$address/api/health" -TimeoutSec 2
    if ($health.app -eq 'procision' -and $health.workspace -eq $projectRoot) { $healthy = $true }
} catch { }
if (-not $healthy) {
    $nodePath = (Get-Command node -ErrorAction Stop).Source
    $nodeVersion = & $nodePath --version
    if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 24) { throw 'Procision requires Node.js 24 or later.' }
    $dataPath = Join-Path $projectRoot 'data'
    New-Item -ItemType Directory -Path $dataPath -Force | Out-Null
    $env:PORT = "$port"
    Start-Process -FilePath $nodePath -ArgumentList ('"' + (Join-Path $projectRoot 'server.mjs') + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataPath 'server.log') -RedirectStandardError (Join-Path $dataPath 'server-error.log') | Out-Null
    for ($attempt = 0; $attempt -lt 25; $attempt++) {
        Start-Sleep -Milliseconds 200
        try {
            $health = Invoke-RestMethod -Uri "$address/api/health" -TimeoutSec 1
            if ($health.app -eq 'procision' -and $health.workspace -eq $projectRoot) { $healthy = $true; break }
        } catch { }
    }
}
if (-not $healthy) { throw "Unable to start Procision. Check port $port and data/server-error.log." }
if (-not $NoBrowser) { Start-Process $address }
Write-Output "Procision is ready: $address"
