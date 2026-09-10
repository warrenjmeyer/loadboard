# ---------------------------------------------------------------------------
# Push the blob storage connection string into the Static Web App's
# application settings.
#
# The API reads STORAGE_CONNECTION (api/src/storage.js) to put uploaded
# documents -- BOLs, PODs, receipts -- into a private container and to mint
# the short-lived URLs the browser views them with. Like the SQL and the
# GeoTab credentials, it lives in Azure and never in this repo, and the
# browser never sees it.
#
# Prompts for the string with masked input, so it does not land in your
# terminal history. The string is on the storage account's "Access keys"
# page; either key1 or key2 works, and if one has ever been pasted where it
# should not have been, regenerate it there and run this again.
#
# Usage:
#   .\set-storage-secrets.ps1
#   .\set-storage-secrets.ps1 -Container documents
#   $env:STORAGE_CONNECTION = '...'; .\set-storage-secrets.ps1   # unprompted
# ---------------------------------------------------------------------------

param(
  [string]$AppName       = 'loadboard-wjm',
  [string]$ResourceGroup = 'loadboard-rg',
  [string]$Container     = 'documents'
)

$ErrorActionPreference = 'Stop'

$connection = $env:STORAGE_CONNECTION
if ([string]::IsNullOrWhiteSpace($connection)) {
  $secure     = Read-Host 'Storage connection string (DefaultEndpointsProtocol=https;AccountName=...)' -AsSecureString
  $bstr       = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $connection = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

if ($connection -notmatch 'AccountName=' -or $connection -notmatch 'AccountKey=') {
  throw 'That does not look like a storage connection string: it needs AccountName= and AccountKey=.'
}

Write-Host "Setting storage application settings on $AppName ..." -ForegroundColor Cyan

# Output is suppressed because the response echoes every setting back,
# every credential included, and that would land in your scrollback.
az staticwebapp appsettings set `
  --name $AppName `
  --resource-group $ResourceGroup `
  --setting-names `
    "STORAGE_CONNECTION=$connection" `
    "STORAGE_CONTAINER=$Container" `
  --output none

if ($LASTEXITCODE -ne 0) { throw "Failed to set application settings." }

Remove-Variable connection

Write-Host "Done. The API creates the container on first use if it is missing; no redeploy needed." -ForegroundColor Green
