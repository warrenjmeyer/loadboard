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

    # A Route has no `groups` property -- confirmed by reading one back with
    # -ShowSchema. It does carry a timezone.
    [string]$TimeZoneId = 'America/Chicago',

    [switch]$ListRoutes,

    # Print an existing route exactly as Geotab returns it, and exit. Make one
    # by hand in MyGeotab first; reading its shape beats guessing at the schema
    # one rejection at a time.
    [switch]$ShowSchema,

    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'geotab-common.ps1')

function New-RouteStop {
    <#
        One stop on a route, shaped like the ones MyGeotab creates.

        The date fields are not decoration: a stop with no activeFrom/activeTo
        is not active, and dateTime is required even on a route that has no
        schedule. The values here are what the UI writes for a basic route.
    #>
    param(
        [Parameter(Mandatory)][string]$ZoneId,
        [Parameter(Mandatory)][int]$Sequence
    )

    return @{
        zone           = @{ id = $ZoneId }
        sequence       = $Sequence
        activeFrom     = '1986-01-01T00:00:00.000Z'
        activeTo       = '2050-01-01T00:00:00.000Z'
        dateTime       = '2018-01-01T00:00:00.000Z'
        comment        = ''
        nonOptimizable = $false
    }
}

# --- the lanes -------------------------------------------------------------
$pattern = "N'([A-Z .]+, [A-Z]{2}) - ([A-Z .]+, [A-Z]{2})'"
$files = Get-ChildItem -Path (Join-Path $PSScriptRoot $SqlGlob) -ErrorAction SilentlyContinue
if (-not $files -and -not ($ShowSchema -or $ListRoutes)) {
    # The diagnostic modes read from Geotab, not from the seed files, so they
    # should not be blocked by a missing SQL glob.
    throw "No settlement SQL found matching $SqlGlob."
}

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

if ($ShowSchema) {
    if (-not $existingRoutes -or $existingRoutes.Count -eq 0) {
        throw 'No routes exist yet. Create one by hand in MyGeotab (Zones & Messages > Routes > Add), give it two zone stops, then run this again.'
    }

    # Prefer one with stops on it. A route with none would show the property
    # exists but not what belongs inside it, which is the part being checked.
    $sample = $existingRoutes |
        Where-Object { $_.routePlanItemCollection -and $_.routePlanItemCollection.Count -gt 0 } |
        Select-Object -First 1
    if (-not $sample) {
        Write-Host 'No route has any stops; showing the first one anyway.' -ForegroundColor Yellow
        $sample = $existingRoutes[0]
    }

    Write-Host ''
    Write-Host "Route: $($sample.name)" -ForegroundColor Cyan
    Write-Host 'Top-level properties Geotab returned:' -ForegroundColor Cyan
    $sample.PSObject.Properties |
        Select-Object Name, @{n = 'Type'; e = { if ($null -eq $_.Value) { '(null)' } else { $_.Value.GetType().Name } } } |
        Sort-Object Name | Format-Table -AutoSize | Out-String | Write-Host

    Write-Host 'Full object:' -ForegroundColor Cyan
    $sample | ConvertTo-Json -Depth 10 | Write-Host

    # Called out separately because this is the property that has already cost
    # two failed guesses, and its item shape is what the Add has to match.
    if ($sample.routePlanItemCollection) {
        Write-Host ''
        Write-Host 'One stop, in isolation:' -ForegroundColor Cyan
        $sample.routePlanItemCollection[0] | ConvertTo-Json -Depth 6 | Write-Host
    }
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
            # This shape was read back off a route created by hand in MyGeotab
            # (-ShowSchema), not taken from the SDK docs. Two things the docs
            # cost us: the stops property is routePlanItemCollection rather
            # than routePlanItems, and a Route carries no `groups` at all --
            # the real object simply does not have that property.
            name         = $key
            comment      = 'Load board lane'
            routeType    = 'Basic'
            timezoneId   = $TimeZoneId
            isRepeatable = $false

            # The UI writes this sentinel for a route with no schedule. Mirrored
            # rather than invented, so these look like every other basic route.
            startTime    = '2018-01-01T00:00:00.000Z'
            endTime      = '2018-01-01T00:00:00.000Z'

            # Sequence is what makes this a route rather than a pair of places:
            # origin first, destination second. Every other field here is one
            # the real object carries; `id` is left out because Geotab assigns
            # it.
            routePlanItemCollection = @(
                (New-RouteStop -ZoneId $zoneByName[$lane.Origin.ToUpper()] -Sequence 0),
                (New-RouteStop -ZoneId $zoneByName[$lane.Destination.ToUpper()] -Sequence 1)
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
