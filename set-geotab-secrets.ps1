# ---------------------------------------------------------------------------
# Push the MyGeotab credential into the Static Web App's application settings.
#
# The API reads GEOTAB_DATABASE, GEOTAB_USER and GEOTAB_PASSWORD from its
# environment (api/src/geotab.js) to sign in to MyGeotab and read back where
# the trucks are and how many hours each driver has. Like the SQL password in
# set-api-secrets.ps1, these live in Azure and never in this repo, and the
# browser cannot see them: it talks to /api/telematics, which talks to Geotab.
#
# The MyGeotab password is ITS OWN credential. Same email as the Azure
# sign-in, different password -- see the note in geotab-common.ps1.
#
# Until this has been run, /api/telematics/* answers 503 "not connected" and
# the pages simply do not show the live sections. Nothing else breaks.
#
# Usage:
#   $env:GEOTAB_PASSWORD = '...'   # or you will be prompted, masked
#   .\set-geotab-secrets.ps1
#   .\set-geotab-secrets.ps1 -Database demo_millstream -UserName warrenjmeyer@live.com
# ---------------------------------------------------------------------------

param(
  [string]$AppName       = 'loadboard-wjm',
  [string]$ResourceGroup = 'loadboard-rg',

  # demo_millstream, not Millstream: "Millstream" is the company name and the
  # SQL database; the MyGeotab database is this one.
  [string]$Database      = 'demo_millstream',
  [string]$UserName      = 'warrenjmeyer@live.com'
)

$ErrorActionPreference = 'Stop'

$password = $env:GEOTAB_PASSWORD
if ([string]::IsNullOrWhiteSpace($password)) {
  $secure   = Read-Host "MyGeotab password for $UserName on $Database" -AsSecureString
  $bstr     = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $password = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

Write-Host "Setting GeoTab application settings on $AppName ..." -ForegroundColor Cyan

# Output is suppressed because the response echoes every setting back,
# passwords included -- the SQL one too -- and that would land in scrollback.
az staticwebapp appsettings set `
  --name $AppName `
  --resource-group $ResourceGroup `
  --setting-names `
    "GEOTAB_DATABASE=$Database" `
    "GEOTAB_USER=$UserName" `
    "GEOTAB_PASSWORD=$password" `
  --output none

if ($LASTEXITCODE -ne 0) { throw "Failed to set application settings." }

Remove-Variable password

Write-Host "Done. The API signs in to GeoTab on its next request; no redeploy needed." -ForegroundColor Green
Write-Host "Check with:  curl https://wonderful-tree-0a929e80f.7.azurestaticapps.net/api/telematics/positions  (signed in: rows; signed out: 401)"
