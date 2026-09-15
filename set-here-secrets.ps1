# ---------------------------------------------------------------------------
# Push the HERE API key into the Static Web App's application settings.
#
# WHY THIS SCRIPT EXISTS AT ALL. A basemap key has to ship to the browser; a
# ROUTING key does not. The plan for HERE here is server-side only -- the API
# asks HERE for a truck-legal route and hands the app an ETA -- so the key
# lives in Azure next to the GeoTab and SQL ones, never in this repo, never
# in a bundle, and never in a screenshot. That is the whole reason the ETA is
# being built behind /api/ rather than on the map.
#
# The key is read by the Function App from HERE_API_KEY. Until this has been
# run, the ETA route answers 503 "not connected", the same way
# /api/telematics/* does without the GeoTab settings, and nothing else breaks.
#
# TRANSACTIONS COST MONEY ABOVE THE FREE TIER, so this key is worth treating
# like the others: if it is ever pasted anywhere it can be read, roll it in
# the HERE portal and run this again. That is what happened to the storage
# key in September; rolling it is cheap and doing nothing is not.
#
# Usage:
#   $env:HERE_API_KEY = '...'   # or you will be prompted, masked
#   .\set-here-secrets.ps1
#
# Previews copy application settings when they are CREATED, so a preview
# opened before this ran needs it again with --environment-name <PR#>.
# ---------------------------------------------------------------------------

param(
  [string]$AppName       = 'loadboard-wjm',
  [string]$ResourceGroup = 'loadboard-rg',

  # A PR preview rather than production: .\set-here-secrets.ps1 -Environment 15
  [string]$Environment   = ''
)

$ErrorActionPreference = 'Stop'

$apiKey = $env:HERE_API_KEY
if ([string]::IsNullOrWhiteSpace($apiKey)) {
  $secure = Read-Host "HERE API key (from the app you registered under REST APIs)" -AsSecureString
  $bstr   = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $apiKey = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

if ([string]::IsNullOrWhiteSpace($apiKey)) { throw "No API key given." }

$target = if ($Environment) { "$AppName (preview $Environment)" } else { $AppName }
Write-Host "Setting HERE_API_KEY on $target ..." -ForegroundColor Cyan

# Output suppressed: the response echoes every setting back, the SQL and
# GeoTab passwords included, and that would land in scrollback.
if ($Environment) {
  az staticwebapp appsettings set `
    --name $AppName `
    --resource-group $ResourceGroup `
    --environment-name $Environment `
    --setting-names "HERE_API_KEY=$apiKey" `
    --output none
} else {
  az staticwebapp appsettings set `
    --name $AppName `
    --resource-group $ResourceGroup `
    --setting-names "HERE_API_KEY=$apiKey" `
    --output none
}

if ($LASTEXITCODE -ne 0) { throw "Failed to set application settings." }

Remove-Variable apiKey

Write-Host "Done. The API picks it up on its next request; no redeploy needed." -ForegroundColor Green
