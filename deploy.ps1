# ---------------------------------------------------------------------------
# Build the React app and publish it to Azure Static Web Apps (Free tier).
#
# Prerequisites (one time):
#   1. winget install Microsoft.AzureCLI      (then restart your terminal)
#   2. az login                               (use warrenjmeyer@live.com)
#   3. .\deploy.ps1 -Provision                (creates the resource group + app)
#
# Why Static Web Apps and not blob storage static websites: the Free SKU costs
# nothing, includes managed HTTPS on a custom domain, and -- the part that
# matters here -- gives you a managed /api backed by Azure Functions. A blob
# container can only ever serve files, so it could never host the login flow
# the auth schema in Millstream is built for. The SQL connection string lives
# in the Function App's settings, server-side, never in the bundle.
#
# Usage:
#   .\deploy.ps1 -Provision    # first run: create the Azure resources, then deploy
#   .\deploy.ps1               # every run after that: build + deploy
# ---------------------------------------------------------------------------

param(
  [string]$AppName       = 'loadboard-wjm',
  [string]$ResourceGroup = 'loadboard-rg',

  # The Free SKU is only offered in a handful of regions; eastus2 is one of
  # them. Picking an unsupported region fails at create time with a message
  # that does not mention the SKU, which is a confusing half hour.
  [string]$Location      = 'eastus2',

  [switch]$Provision
)

$ErrorActionPreference = 'Stop'

# --- provision (first run only) --------------------------------------------
if ($Provision) {
  Write-Host "Creating resource group $ResourceGroup ..." -ForegroundColor Cyan
  az group create --name $ResourceGroup --location $Location --output none
  if ($LASTEXITCODE -ne 0) { throw "Resource group create failed." }

  # No --source/--repository-url: that form wires up a GitHub Actions workflow
  # and expects to own your repo. Omitting it creates a "bring your own
  # deployment" app that you push to with a deployment token instead, which is
  # what this script does below.
  Write-Host "Creating static web app $AppName (Free SKU) ..." -ForegroundColor Cyan
  az staticwebapp create `
    --name $AppName `
    --resource-group $ResourceGroup `
    --location $Location `
    --sku Free `
    --output none
  if ($LASTEXITCODE -ne 0) { throw "Static web app create failed." }
}

# --- build -----------------------------------------------------------------
Write-Host "Building..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "Build failed." }

# --- deploy ----------------------------------------------------------------
# The deployment token is the app's own credential -- it is not tied to your
# az login, which is why the same command works unchanged from CI later. Keep
# it out of the shell: it is fetched into a variable and never printed.
Write-Host "Fetching deployment token..." -ForegroundColor Cyan
$token = az staticwebapp secrets list `
  --name $AppName `
  --resource-group $ResourceGroup `
  --query "properties.apiKey" `
  --output tsv
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($token)) {
  throw "Could not read the deployment token. Has the app been provisioned (-Provision)?"
}

# --env production publishes to the app's real hostname. Any other value
# creates a *preview* environment on a URL of its own, which is genuinely
# useful for trying a change before it goes live.
Write-Host "Deploying dist/ ..." -ForegroundColor Cyan
npx --no-install swa deploy ./dist --api-location ./api --deployment-token $token --env production
if ($LASTEXITCODE -ne 0) { throw "Deploy failed." }

$url = az staticwebapp show `
  --name $AppName `
  --resource-group $ResourceGroup `
  --query "defaultHostname" `
  --output tsv

Write-Host ""
Write-Host "Deployed: https://$url" -ForegroundColor Green
Write-Host "If you see a stale version, hard-refresh (Ctrl+F5) -- Vite fingerprints"
Write-Host "asset filenames, but index.html itself can sit in the browser cache."
