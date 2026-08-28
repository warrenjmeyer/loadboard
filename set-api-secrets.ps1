# ---------------------------------------------------------------------------
# Push the SQL credential into the Static Web App's application settings.
#
# These settings become environment variables inside the Function App, which
# is how api/src/functions/loads.js reaches the database. They live in Azure,
# not in this repo -- nothing here is ever committed, and the browser cannot
# see them.
#
# Run this once, and again whenever the password changes.
#
# Usage:
#   $env:MILLSTREAM_PASSWORD = '...'   # or you will be prompted, masked
#   .\set-api-secrets.ps1
# ---------------------------------------------------------------------------

param(
  [string]$AppName       = 'loadboard-wjm',
  [string]$ResourceGroup = 'loadboard-rg',
  [string]$Server        = 'millstream-wjm.database.windows.net',
  [string]$Database      = 'Millstream',

  # sqlmillstream, not app_millstream: the latter carries schema-level DENYs
  # and fails in a way that looks like a rights problem but is not.
  [string]$UserId        = 'sqlmillstream'
)

$ErrorActionPreference = 'Stop'

$password = $env:MILLSTREAM_PASSWORD
if ([string]::IsNullOrWhiteSpace($password)) {
  $secure   = Read-Host "Password for $UserId@$Server" -AsSecureString
  $bstr     = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $password = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

Write-Host "Setting API application settings on $AppName ..." -ForegroundColor Cyan

# --setting-names is the (badly named) flag that takes key=value pairs.
# Output is suppressed because the response echoes every setting back,
# password included, and that would land in your scrollback.
az staticwebapp appsettings set `
  --name $AppName `
  --resource-group $ResourceGroup `
  --setting-names `
    "SQL_SERVER=$Server" `
    "SQL_DATABASE=$Database" `
    "SQL_USER=$UserId" `
    "SQL_PASSWORD=$password" `
  --output none

if ($LASTEXITCODE -ne 0) { throw "Failed to set application settings." }

Remove-Variable password

Write-Host "Done. Settings are stored in Azure, not in this repo." -ForegroundColor Green
Write-Host "Verify with:  az staticwebapp appsettings list --name $AppName --resource-group $ResourceGroup --output table"
