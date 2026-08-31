# ---------------------------------------------------------------------------
# Create a geofence for every city the load lanes touch.
#
# Usage:
#   .\geotab-add-zones.ps1 -Database demo_millstream -CheckTelematics
#   .\geotab-add-zones.ps1 -Database demo_millstream -WhatIf
#   .\geotab-add-zones.ps1 -Database demo_millstream
#
#   .\geotab-add-zones.ps1 -Database demo_millstream -ListZones
#
# A Zone is a named polygon. Once one exists, arrivals and departures start
# appearing in reports on their own -- no route plan needed. Zones are also the
# prerequisite for Routes, whose stops are references to zones.
#
# The coordinates below are city centres, not docks. A zone here answers "the
# truck reached Dubuque", not "the truck reached the receiver". Replace them
# with real facility coordinates when you have them.
#
# Re-running is safe: zones are matched by name and skipped if present.
# ---------------------------------------------------------------------------

[CmdletBinding()]
param(
    [string]$Database = $env:GEOTAB_DATABASE,
    [string]$UserName = $env:GEOTAB_USER,
    [string]$Server = 'my.geotab.com',

    # Half-width of the square drawn around each city centre. 3km is big enough
    # to catch a truck stopping anywhere near the middle of town and small
    # enough that neighbouring cities never overlap.
    [double]$RadiusKm = 3.0,

    [string]$ZoneTypeId = 'ZoneTypeCustomerId',
    [string]$CompanyGroupId = 'GroupCompanyId',

    [switch]$CheckTelematics,
    [switch]$ListZones,
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'geotab-common.ps1')

# City centres for every city in the settlement lanes. Approximate, and
# deliberately so -- see the header.
$CITIES = @(
    @{ Name = 'CEDAR RAPIDS, IA';  Lat = 41.9779; Lon = -91.6656 },
    @{ Name = 'CHICAGO, IL';       Lat = 41.8781; Lon = -87.6298 },
    @{ Name = 'DALLAS, TX';        Lat = 32.7767; Lon = -96.7970 },
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
