# ---------------------------------------------------------------------------
# Create geofences for the places this fleet actually goes.
#
# Usage:
#   .\geotab-add-zones.ps1 -Database demo_millstream -CheckTelematics
#   .\geotab-add-zones.ps1 -Database demo_millstream -WhatIf
#   .\geotab-add-zones.ps1 -Database demo_millstream
#
#   .\geotab-add-zones.ps1 -Database demo_millstream -ListZones
#   .\geotab-add-zones.ps1 -Database demo_millstream -FromLanes
#
# A Zone is a named polygon. Once one exists, arrivals and departures start
# appearing in reports on their own -- no route plan needed. Zones are also the
# prerequisite for Routes, whose stops are references to zones.
#
# By default the zones are DERIVED from where the fleet actually stops: recent
# trips are read, their stop points clustered, and the busiest places become
# zones. A zone is only worth having somewhere a truck goes.
#
# -FromLanes instead uses the cities the lane data touches -- settlements and
# the load board both. Correct configuration, but this fleet drives around Las
# Vegas, so nothing would ever enter one.
#
# Re-running is safe: zones are matched by name and skipped if present.
# ---------------------------------------------------------------------------

[CmdletBinding()]
param(
    [string]$Database = $env:GEOTAB_DATABASE,
    [string]$UserName = $env:GEOTAB_USER,
    [string]$Server = 'my.geotab.com',

    # Half-width of the square drawn around each zone centre.
    [double]$RadiusKm = 3.0,

    [string]$ZoneTypeId = 'ZoneTypeCustomerId',
    [string]$CompanyGroupId = 'GroupCompanyId',

    [switch]$CheckTelematics,
    [switch]$ListZones,

    # Create zones for the cities the lanes touch, instead of the places the
    # fleet actually visits. Correct configuration, but the demo vehicles drive
    # around Las Vegas, so nothing will ever enter one.
    [switch]$FromLanes,

    # How much history to read when working out where the fleet stops.
    [int]$Days = 7,

    # Stops closer together than this are treated as the same place. A truck
    # never parks on the same square metre twice, so without clustering every
    # visit to one yard becomes its own zone.
    [double]$ClusterKm = 1.5,

    [int]$MaxZones = 18,

    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'geotab-common.ps1')

# Used only by -FromLanes. Coordinates only: WHICH cities are needed is derived
# from the lane data, not listed here. A hand-maintained list of cities is what
# let the load board grow to 19 cities while the zones stayed at 18, so this
# file now answers "where is Dubuque", never "which cities matter".
#
# Approximate by design -- these answer "reached Dubuque", not "reached the
# receiver".
$CITY_COORDS = @(
    @{ Name = 'CEDAR RAPIDS, IA';  Lat = 41.9779; Lon = -91.6656 },
    @{ Name = 'CHICAGO, IL';       Lat = 41.8781; Lon = -87.6298 },
    @{ Name = 'DALLAS, TX';        Lat = 32.7767; Lon = -96.7970 },
    @{ Name = 'DAVENPORT, IA';     Lat = 41.5236; Lon = -90.5776 },
    @{ Name = 'DENVER, CO';        Lat = 39.7392; Lon = -104.9903 },
    @{ Name = 'DES MOINES, IA';    Lat = 41.5868; Lon = -93.6250 },
    @{ Name = 'DUBUQUE, IA';       Lat = 42.5006; Lon = -90.6646 },
    @{ Name = 'INDIANAPOLIS, IN';  Lat = 39.7684; Lon = -86.1581 },
    @{ Name = 'IOWA CITY, IA';     Lat = 41.6611; Lon = -91.5302 },
    @{ Name = 'KANSAS CITY, MO';   Lat = 39.0997; Lon = -94.5786 },
    @{ Name = 'MEMPHIS, TN';       Lat = 35.1495; Lon = -90.0490 },
    @{ Name = 'MILWAUKEE, WI';     Lat = 43.0389; Lon = -87.9065 },
    @{ Name = 'MINNEAPOLIS, MN';   Lat = 44.9778; Lon = -93.2650 },
    @{ Name = 'NASHVILLE, TN';     Lat = 36.1627; Lon = -86.7816 },
    @{ Name = 'OKLAHOMA CITY, OK'; Lat = 35.4676; Lon = -97.5164 },
    @{ Name = 'OMAHA, NE';         Lat = 41.2565; Lon = -95.9345 },
    @{ Name = 'SIOUX CITY, IA';    Lat = 42.4999; Lon = -96.4003 },
    @{ Name = 'ST. LOUIS, MO';     Lat = 38.6270; Lon = -90.1994 },
    @{ Name = 'WATERLOO, IA';      Lat = 42.4928; Lon = -92.3426 }
)

if ([string]::IsNullOrWhiteSpace($Database)) { $Database = Read-Host 'MyGeotab database' }
if ([string]::IsNullOrWhiteSpace($UserName)) { $UserName = Read-Host 'MyGeotab user' }
$password = Read-GeotabPassword -UserName $UserName

Write-Host "Authenticating to $Database ..." -ForegroundColor Cyan
$session = Connect-Geotab -Database $Database -UserName $UserName -Password $password -Server $Server
Remove-Variable password
$creds = $session.Credentials
$api = $session.Server
Write-Host "  authenticated; using $api" -ForegroundColor Green

# --- do the vehicles actually report a position? ---------------------------
if ($CheckTelematics) {
    # DeviceStatusInfo carries each device's last known position. Far cheaper
    # than pulling LogRecords, and it answers the only question being asked:
    # has this vehicle ever told us where it is?
    $status = Invoke-Geotab -ApiServer $api -Method 'Get' -Params @{
        typeName    = 'DeviceStatusInfo'
        credentials = $creds
    }
    $devices = Invoke-Geotab -ApiServer $api -Method 'Get' -Params @{
        typeName    = 'Device'
        credentials = $creds
    }
    $nameById = @{}
    foreach ($d in $devices) { $nameById[$d.id] = $d.name }

    Write-Host ''
    Write-Host "$($devices.Count) vehicles, $($status.Count) with a status record" -ForegroundColor Cyan

    $moving = 0
    foreach ($s in ($status | Sort-Object { $nameById[$_.device.id] })) {
        $hasFix = $s.latitude -and $s.longitude -and -not ($s.latitude -eq 0 -and $s.longitude -eq 0)
        if ($hasFix) { $moving++ }
        $where = 'no position'
        if ($hasFix) { $where = '{0:N4}, {1:N4}' -f $s.latitude, $s.longitude }
        Write-Host ("  {0,-14} {1,-22} {2}" -f $nameById[$s.device.id], $where, $s.dateTime)
    }

    Write-Host ''
    if ($moving -gt 0) {
        Write-Host "$moving vehicle(s) have reported a position -- zones and routes will register arrivals." -ForegroundColor Green
    } else {
        Write-Host 'No vehicle has reported a position. Zones will be correct configuration but nothing will ever be recorded against them.' -ForegroundColor Yellow
    }
    return
}

# --- what is already there -------------------------------------------------
$existing = Invoke-Geotab -ApiServer $api -Method 'Get' -Params @{
    typeName    = 'Zone'
    credentials = $creds
}

if ($ListZones) {
    $existing | Select-Object name, id | Sort-Object name | Format-Table -AutoSize | Out-String | Write-Host
    Write-Host "$($existing.Count) zones."
    return
}

$have = @{}
foreach ($z in $existing) { if ($z.name) { $have[$z.name.ToUpper()] = $true } }
Write-Host "  $($existing.Count) zones already in this database" -ForegroundColor DarkGray
Write-Host ''

# --- the cities the lanes actually touch -----------------------------------
if ($FromLanes) {
    $lanes = Get-Lanes -ScriptRoot $PSScriptRoot

    $needed = [ordered]@{}
    foreach ($lane in $lanes.Values) {
        foreach ($city in @($lane.Origin, $lane.Destination)) {
            if (-not $needed.Contains($city)) { $needed[$city] = $true }
        }
    }

    $coordByName = @{}
    foreach ($c in $CITY_COORDS) { $coordByName[$c.Name.ToUpper()] = $c }

    # Fail on a city with no coordinates rather than quietly leaving it out.
    # Silently skipping is precisely how the zones ended up one city short of
    # the lanes and nobody noticed until the routes could not resolve.
    $unknown = @($needed.Keys | Where-Object { -not $coordByName.ContainsKey($_) })
    if ($unknown.Count) {
        throw "No coordinates for: $($unknown -join '; '). Add them to `$CITY_COORDS in this script."
    }

    $CITIES = @($needed.Keys | ForEach-Object { $coordByName[$_] })
    Write-Host "$($lanes.Count) lanes touch $($CITIES.Count) cities" -ForegroundColor Cyan
    Write-Host ''
}

# --- where does the fleet actually stop? -----------------------------------
# Unless -FromLanes was asked for, the zone list is derived rather than
# assumed. A zone is only worth having somewhere a truck goes, and guessing
# that from a map is how you end up with eighteen geofences in Iowa and a fleet
# in Nevada.
if (-not $FromLanes) {
    $from = (Get-Date).ToUniversalTime().AddDays(-$Days).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    $to = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')

    Write-Host "Reading trips from the last $Days days..." -ForegroundColor Cyan
    $trips = Invoke-Geotab -ApiServer $api -Method 'Get' -Params @{
        typeName    = 'Trip'
        credentials = $creds
        search      = @{ fromDate = $from; toDate = $to }
    }

    # A trip's stopPoint is where it ended -- a yard, a dock, a truck stop.
    # That is what a zone should sit on, far more than the position a vehicle
    # happens to occupy right now.
    $stops = @()
    foreach ($t in $trips) {
        if ($t.stopPoint -and $t.stopPoint.y -and $t.stopPoint.x) {
            $stops += [pscustomobject]@{ Lat = [double]$t.stopPoint.y; Lon = [double]$t.stopPoint.x }
        }
    }
    Write-Host "  $($trips.Count) trips, $($stops.Count) with a stop position" -ForegroundColor DarkGray

    if ($stops.Count -eq 0) {
        throw "No trip stop positions in the last $Days days. Try -Days 30, or -FromLanes to use the settlement lane cities instead."
    }

    # Greedy clustering: walk the stops, drop each into the first cluster it is
    # near enough to, otherwise start a new one. Good enough for finding depots
    # in a few thousand points, and it needs no libraries.
    $clusters = New-Object System.Collections.ArrayList
    foreach ($s in $stops) {
        $placed = $false
        foreach ($c in $clusters) {
            # Equirectangular approximation. Exact enough over a few km, and it
            # avoids a trigonometric haversine per point-pair comparison.
            $dLatKm = ($s.Lat - $c.Lat) * 111.0
            $dLonKm = ($s.Lon - $c.Lon) * 111.0 * [Math]::Cos($c.Lat * [Math]::PI / 180.0)
            if ([Math]::Sqrt($dLatKm * $dLatKm + $dLonKm * $dLonKm) -le $ClusterKm) {
                # Running mean, so the centre settles on the middle of the yard
                # rather than wherever the first truck happened to park.
                $c.Count++
                $c.Lat = $c.Lat + (($s.Lat - $c.Lat) / $c.Count)
                $c.Lon = $c.Lon + (($s.Lon - $c.Lon) / $c.Count)
                $placed = $true
                break
            }
        }
        if (-not $placed) {
            [void]$clusters.Add([pscustomobject]@{ Lat = $s.Lat; Lon = $s.Lon; Count = 1 })
        }
    }

    $top = $clusters | Sort-Object -Property Count -Descending | Select-Object -First $MaxZones
    Write-Host "  $($clusters.Count) distinct places; taking the $($top.Count) most visited" -ForegroundColor DarkGray

    # Ask Geotab what these places are called. Nicer than "Fleet Stop 03", and
    # if the method is unavailable the fallback name still works.
    $labels = @{}
    try {
        $coords = @($top | ForEach-Object { @{ x = $_.Lon; y = $_.Lat } })
        $addresses = Invoke-Geotab -ApiServer $api -Method 'GetAddresses' -Params @{
            coordinates = $coords
            credentials = $creds
        }
        for ($i = 0; $i -lt $addresses.Count; $i++) {
            $a = $addresses[$i]
            $text = $a
            if ($a -is [psobject] -and $a.PSObject.Properties.Name -contains 'formattedAddress') {
                $text = $a.formattedAddress
            }
            if ($text) { $labels[$i] = ([string]$text).Trim() }
        }
    } catch {
        Write-Host '  (address lookup unavailable; naming by position)' -ForegroundColor DarkGray
    }

    $CITIES = @()
    for ($i = 0; $i -lt $top.Count; $i++) {
        $label = $labels[$i]
        if ([string]::IsNullOrWhiteSpace($label)) {
            $label = 'Fleet Stop {0:D2}' -f ($i + 1)
        }
        # Zone names must be unique, and two clusters can easily sit on one
        # street address.
        $name = '{0} ({1} stops)' -f $label, $top[$i].Count
        $CITIES += @{ Name = $name; Lat = $top[$i].Lat; Lon = $top[$i].Lon }
    }

    Write-Host ''
}

# --- create ----------------------------------------------------------------
$created = 0
$skipped = 0

foreach ($city in $CITIES) {
    if ($have.ContainsKey($city.Name.ToUpper())) {
        Write-Host ("  {0,-20} already exists" -f $city.Name) -ForegroundColor DarkGray
        $skipped++
        continue
    }

    # A degree of latitude is ~111km everywhere. A degree of longitude shrinks
    # towards the poles, so it is divided by cos(latitude) -- without that, a
    # zone in Minneapolis comes out noticeably wider east-west than one in
    # Dallas, despite both asking for the same radius.
    $dLat = $RadiusKm / 111.0
    $dLon = $RadiusKm / (111.0 * [Math]::Cos($city.Lat * [Math]::PI / 180.0))

    # Geotab points are x = longitude, y = latitude. Getting these the wrong way
    # round puts Iowa in the Indian Ocean.
    $points = @(
        @{ x = $city.Lon - $dLon; y = $city.Lat - $dLat },
        @{ x = $city.Lon + $dLon; y = $city.Lat - $dLat },
        @{ x = $city.Lon + $dLon; y = $city.Lat + $dLat },
        @{ x = $city.Lon - $dLon; y = $city.Lat + $dLat }
    )

    if ($WhatIf) {
        Write-Host ("  would create {0,-20} {1:N4}, {2:N4}  ({3}km box)" -f $city.Name, $city.Lat, $city.Lon, $RadiusKm)
        continue
    }

    Invoke-Geotab -ApiServer $api -Method 'Add' -Params @{
        typeName    = 'Zone'
        credentials = $creds
        entity      = @{
            name       = $city.Name
            points     = $points
            zoneTypes  = @(@{ id = $ZoneTypeId })
            groups     = @(@{ id = $CompanyGroupId })
            activeFrom = '2020-01-01T00:00:00.000Z'
            activeTo   = '2050-01-01T00:00:00.000Z'
            displayed  = $true
            comment    = 'Load board lane endpoint'
        }
    } | Out-Null

    Write-Host ("  {0,-20} {1:N4}, {2:N4}" -f $city.Name, $city.Lat, $city.Lon) -ForegroundColor Green
    $created++
}

Write-Host ''
if ($WhatIf) {
    Write-Host 'Nothing was created (-WhatIf).' -ForegroundColor Yellow
} else {
    Write-Host "Created $created zone(s), skipped $skipped already present." -ForegroundColor Green
    Write-Host 'They will appear on the map in MyGeotab under Zones & Messages.'
}
