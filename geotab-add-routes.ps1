# ---------------------------------------------------------------------------
# Create a MyGeotab route for every lane in the settlement data.
#
# Usage:
#   .\geotab-add-zones.ps1  -Database demo_millstream -FromLanes   # do this first
#   .\geotab-add-routes.ps1 -Database demo_millstream -WhatIf
#   .\geotab-add-routes.ps1 -Database demo_millstream
#
#   .\geotab-add-routes.ps1 -Database demo_millstream -ListRoutes
#
# A Route is an ordered list of stops, and each stop is a reference to a Zone.
# So the zones have to exist first -- this script looks them up by name and
# refuses to invent anything if one is missing.
#
# The lanes are read from the settlement SQL rather than duplicated here. There
# is one list of lanes in this project and it lives in the seed files; a second
# copy would drift the first time a lane changed.
#
# Worth being clear about what these will and will not do: the vehicles in this
# database drive around Las Vegas, so no truck will enter a Midwest zone and
# route adherence will stay empty. These routes describe the lane network the
# pay statements are built on, which is a different and still useful thing.
#
# Re-running is safe: routes are matched by name and skipped if present.
# ---------------------------------------------------------------------------

[CmdletBinding()]
param(
    [string]$Database = $env:GEOTAB_DATABASE,
    [string]$UserName = $env:GEOTAB_USER,
    [string]$Server = 'my.geotab.com',

    # Where the lanes come from. Anything matching "CITY, ST - CITY, ST" inside
    # an N'...' literal counts.
    [string]$SqlGlob = 'settlement_0*.sql',

    [string]$CompanyGroupId = 'GroupCompanyId',

    [switch]$ListRoutes,
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'geotab-common.ps1')

# --- the lanes -------------------------------------------------------------
$pattern = "N'([A-Z .]+, [A-Z]{2}) - ([A-Z .]+, [A-Z]{2})'"
$files = Get-ChildItem -Path (Join-Path $PSScriptRoot $SqlGlob) -ErrorAction SilentlyContinue
if (-not $files) { throw "No settlement SQL found matching $SqlGlob." }

$lanes = [ordered]@{}
foreach ($m in (Select-String -Path $files.FullName -Pattern $pattern -AllMatches).Matches) {
    $origin = $m.Groups[1].Value
    $destination = $m.Groups[2].Value
    $key = "$origin - $destination"
    if (-not $lanes.Contains($key)) {
        $lanes[$key] = @{ Origin = $origin; Destination = $destination }
    }
}
Write-Host "$($lanes.Count) distinct lanes in $($files.Count) settlement file(s)" -ForegroundColor Cyan

if ([string]::IsNullOrWhiteSpace($Database)) { $Database = Read-Host 'MyGeotab database' }
if ([string]::IsNullOrWhiteSpace($UserName)) { $UserName = Read-Host 'MyGeotab user' }
$password = Read-GeotabPassword -UserName $UserName

Write-Host "Authenticating to $Database ..." -ForegroundColor Cyan
$session = Connect-Geotab -Database $Database -UserName $UserName -Password $password -Server $Server
Remove-Variable password
$creds = $session.Credentials
$api = $session.Server
Write-Host "  authenticated; using $api" -ForegroundColor Green

# --- existing routes -------------------------------------------------------
$existingRoutes = Invoke-Geotab -ApiServer $api -Method 'Get' -Params @{
    typeName    = 'Route'
    credentials = $creds
}

if ($ListRoutes) {
    $existingRoutes | Select-Object name, id | Sort-Object name |
        Format-Table -AutoSize | Out-String | Write-Host
    Write-Host "$($existingRoutes.Count) routes."
    return
}

$haveRoute = @{}
foreach ($r in $existingRoutes) { if ($r.name) { $haveRoute[$r.name.ToUpper()] = $true } }

# --- zones to point at -----------------------------------------------------
$zones = Invoke-Geotab -ApiServer $api -Method 'Get' -Params @{
    typeName    = 'Zone'
    credentials = $creds
}
$zoneByName = @{}
foreach ($z in $zones) { if ($z.name) { $zoneByName[$z.name.ToUpper()] = $z.id } }

# Check every city up front. Creating half the routes and then failing leaves
# the database in a state nobody asked for and no obvious way to reason about.
$missing = @()
foreach ($lane in $lanes.Values) {
    foreach ($city in @($lane.Origin, $lane.Destination)) {
        if (-not $zoneByName.ContainsKey($city.ToUpper()) -and $missing -notcontains $city) {
            $missing += $city
        }
    }
}
if ($missing.Count) {
    throw "No zone for: $($missing -join '; '). Run: .\geotab-add-zones.ps1 -Database $Database -FromLanes"
}
Write-Host "  $($zones.Count) zones present; every lane endpoint resolved" -ForegroundColor DarkGray
Write-Host ''

# --- create ----------------------------------------------------------------
$created = 0
$skipped = 0

foreach ($key in $lanes.Keys) {
    $lane = $lanes[$key]

    if ($haveRoute.ContainsKey($key.ToUpper())) {
        Write-Host ("  {0,-40} already exists" -f $key) -ForegroundColor DarkGray
        $skipped++
        continue
    }

    if ($WhatIf) {
        Write-Host ("  would create {0}" -f $key)
        continue
    }

    Invoke-Geotab -ApiServer $api -Method 'Add' -Params @{
        typeName    = 'Route'
        credentials = $creds
        entity      = @{
            name    = $key
            comment = 'Load board lane'
            groups  = @(@{ id = $CompanyGroupId })

            # The stops property is routePlanItemCollection, not the
            # routePlanItems the SDK docs suggest. Getting it wrong fails with
            # "Value cannot be null. (Parameter 'The caller
            # (value.RoutePlanItemCollection) was null.')" -- which at least
            # names the property it wanted.
            #
            # Sequence is what makes this a route rather than a pair of places:
            # origin first, destination second.
            routePlanItemCollection = @(
                @{ zone = @{ id = $zoneByName[$lane.Origin.ToUpper()] };      sequence = 0 },
                @{ zone = @{ id = $zoneByName[$lane.Destination.ToUpper()] }; sequence = 1 }
            )
        }
    } | Out-Null

    Write-Host ("  {0}" -f $key) -ForegroundColor Green
    $created++
}

Write-Host ''
if ($WhatIf) {
    Write-Host 'Nothing was created (-WhatIf).' -ForegroundColor Yellow
} else {
    Write-Host "Created $created route(s), skipped $skipped already present." -ForegroundColor Green
    Write-Host 'They appear in MyGeotab under Zones & Messages > Routes.'
}
