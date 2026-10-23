param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
  [string]$ProjectId,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^https://[^/\s]+\.onrender\.com/api$')]
  [string]$ApiUrl
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$clientDir = Join-Path $repoRoot 'client'

foreach ($tool in @('firebase', 'npm.cmd')) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "Required command '$tool' was not found. Install Firebase CLI and Node.js first."
  }
}

if (-not (Test-Path (Join-Path $repoRoot 'firebase.json'))) {
  throw 'Run this script from the MachineGuard repository; firebase.json is missing.'
}

$health = Invoke-RestMethod -Uri "$ApiUrl/health" -TimeoutSec 120
if ($health.status -ne 'ok') {
  throw 'The API health endpoint did not return status=ok; deploy the Render API first.'
}

Push-Location $repoRoot
try {
  $env:VITE_API_URL = $ApiUrl
  & npm.cmd ci --prefix $clientDir
  if ($LASTEXITCODE -ne 0) {
    throw "Installing client dependencies failed with exit code $LASTEXITCODE."
  }

  & npm.cmd run build --prefix $clientDir
  if ($LASTEXITCODE -ne 0) {
    throw "Building the client failed with exit code $LASTEXITCODE."
  }

  & firebase deploy --only hosting --project $ProjectId --non-interactive
  if ($LASTEXITCODE -ne 0) {
    throw "Firebase Hosting deployment failed with exit code $LASTEXITCODE."
  }
}
finally {
  Remove-Item Env:VITE_API_URL -ErrorAction SilentlyContinue
  Pop-Location
}

$siteUrl = "https://$ProjectId.web.app"
Invoke-RestMethod -Uri $siteUrl -TimeoutSec 60 | Out-Null
Write-Host ''
Write-Host "MachineGuard frontend deployed: $siteUrl"
Write-Host "API health: $ApiUrl/health"
