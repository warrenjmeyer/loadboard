# ---------------------------------------------------------------------------
# Assign each driver a vehicle in MyGeotab.
#
# Usage:
#   $env:GEOTAB_PASSWORD = '...'          # or you will be prompted, masked
#   .\geotab-assign-vehicles.ps1 -Database demo_millstream -WhatIf
#   .\geotab-assign-vehicles.ps1 -Database demo_millstream
#
#   .\geotab-assign-vehicles.ps1 -Database demo_millstream -ListDevices
#
# A driver is not a field on a vehicle in Geotab. The association is a
# DriverChange record -- "this driver is in this vehicle from this moment" --
# which is what the Drive app and the HOS logs key off. This adds one per pair.
#
# Pairing is by position after sorting both lists by name. That is stable only
# while the ROSTER is: running it twice on the same people pairs them with the
# same trucks, but inserting one driver shifts every driver after them onto the
# next vehicle along.
#
# *** THAT MATTERS MORE THAN IT LOOKS. ***
#
# The unit number on a settlement is already written into dbo.SettlementRoutes.
# Re-pairing a driver here does not update those rows, so a statement goes on
# saying "Demo - 15" while Geotab says the driver is in Demo - 17, and nothing
# anywhere reports the disagreement. Adding the four owner/operators to the
# twenty drivers already here moves EIGHTEEN of them.
#
# So: use -OnlyNew when adding drivers to a fleet that already has settlements.
# It reads the existing DriverChange records, leaves every current pairing
# alone, and puts the new drivers in the spare trucks. Run the bare form only
# on a fleet whose settlements do not exist yet.
#
# -OutFile writes the pairing as JSON so the settlement unit numbers can be
# updated to match.
# ---------------------------------------------------------------------------

[CmdletBinding()]
param(
    [string]$Database = $env:GEOTAB_DATABASE,
    [string]$UserName = $env:GEOTAB_USER,
    [string]$Server = 'my.geotab.com',

    # Geotab records a moment, not a range. Backdating to the start of the
    # settlement periods means the assignment covers the weeks the statements
    # already cover, rather than starting now and leaving that history blank.
    [string]$AssignedFrom = '2026-08-09T00:00:00.000Z',

    [string]$OutFile = 'driver-vehicles.json',

    [switch]$ListDevices,

    # Assign ONLY drivers who do not already have a vehicle, to vehicles nobody
    # is already in. Existing pairings are read from Geotab and left alone.
    #
    # USE THIS WHENEVER DRIVERS ARE ADDED TO AN ESTABLISHED FLEET, and see the
    # warning in the header above for why. Without it this script re-pairs
    # everyone by position, and adding four drivers to the twenty already here
    # moves eighteen of them to a different truck.
    [switch]$OnlyNew,

    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'geotab-common.ps1')

if ([string]::IsNullOrWhiteSpace($Database)) { $Database = Read-Host 'MyGeotab database' }
if ([string]::IsNullOrWhiteSpace($UserName)) { $UserName = Read-Host 'MyGeotab user' }
$password = Read-GeotabPassword -UserName $UserName

Write-Host "Authenticating to $Database ..." -ForegroundColor Cyan
$session = Connect-Geotab -Database $Database -UserName $UserName -Password $password -Server $Server
Remove-Variable password
$creds = $session.Credentials
$api = $session.Server
Write-Host "  authenticated; using $api" -ForegroundColor Green

# --- what is out there -----------------------------------------------------
$devices = Invoke-Geotab -ApiServer $api -Method 'Get' -Params @{
    typeName    = 'Device'
    credentials = $creds
} | Sort-Object name

if ($ListDevices) {
    $devices | Select-Object name, id, serialNumber, licensePlate |
        Format-Table -AutoSize | Out-String | Write-Host
    Write-Host "$($devices.Count) vehicles."
    return
}

$drivers = Invoke-Geotab -ApiServer $api -Method 'Get' -Params @{
    typeName    = 'User'
    credentials = $creds
} | Where-Object { $_.isDriver } | Sort-Object lastName, firstName

Write-Host "  $($devices.Count) vehicles, $($drivers.Count) drivers" -ForegroundColor DarkGray

if ($devices.Count -eq 0) { throw 'No vehicles in this database.' }
if ($drivers.Count -gt $devices.Count) {
    throw "More drivers ($($drivers.Count)) than vehicles ($($devices.Count)). One vehicle each is not possible."
}

# --- who is already in a truck --------------------------------------------
# Only consulted for -OnlyNew, but fetched before the branch so the summary can
# report it either way. A DriverChange is a moment, not a range, so the CURRENT
# assignment is the most recent record for that driver -- sort descending by
# dateTime and take the first one seen.
if ($OnlyNew) {
    $changes = Invoke-Geotab -ApiServer $api -Method 'Get' -Params @{
        typeName    = 'DriverChange'
        credentials = $creds
        search      = @{ driverChangeType = 'Driver' }
    } | Sort-Object { [datetime]$_.dateTime } -Descending

    $vehicleOfDriver = @{}
    $driverOfVehicle = @{}
    foreach ($c in $changes) {
        $did = $c.driver.id
        $vid = $c.device.id
        if (-not $did -or -not $vid) { continue }
        if (-not $vehicleOfDriver.ContainsKey($did)) { $vehicleOfDriver[$did] = $vid }
        if (-not $driverOfVehicle.ContainsKey($vid)) { $driverOfVehicle[$vid] = $did }
    }

    $assignedDrivers = @($drivers | Where-Object { $vehicleOfDriver.ContainsKey($_.id) })
    $drivers = @($drivers | Where-Object { -not $vehicleOfDriver.ContainsKey($_.id) })
    $devices = @($devices | Where-Object { -not $driverOfVehicle.ContainsKey($_.id) })

    Write-Host ("  -OnlyNew: {0} drivers already have a truck and are untouched" -f $assignedDrivers.Count) -ForegroundColor DarkGray
    Write-Host ("  {0} unassigned drivers, {1} free vehicles" -f $drivers.Count, $devices.Count) -ForegroundColor DarkGray

    if ($drivers.Count -eq 0) {
        Write-Host ''
        Write-Host 'Every driver already has a vehicle. Nothing to do.' -ForegroundColor Green
        return
    }
    if ($drivers.Count -gt $devices.Count) {
        throw "$($drivers.Count) unassigned drivers but only $($devices.Count) free vehicles. Add vehicles in MyGeotab, or free some up, before running this."
    }
}

# --- pair and assign -------------------------------------------------------
Write-Host ''
$pairs = @()

for ($i = 0; $i -lt $drivers.Count; $i++) {
    $driver = $drivers[$i]
    $device = $devices[$i]

    # first initial + last name, uppercase -- the same shape dbo.Drivers uses,
    # so the settlement rows can be matched to this without a lookup table.
    $code = ''
    if ($driver.firstName -and $driver.lastName) {
        $code = ($driver.firstName.Substring(0, 1) + $driver.lastName).ToUpper()
    }

    $pairs += [pscustomobject]@{
        DriverCode = $code
        Driver     = ('{0} {1}' -f $driver.firstName, $driver.lastName).Trim()
        DriverId   = $driver.id
        Vehicle    = $device.name
        VehicleId  = $device.id
        Serial     = $device.serialNumber
    }

    if ($WhatIf) {
        Write-Host ("  would assign {0,-18} -> {1}" -f $driver.name, $device.name)
        continue
    }

    Invoke-Geotab -ApiServer $api -Method 'Add' -Params @{
        typeName    = 'DriverChange'
        credentials = $creds
        entity      = @{
            dateTime = $AssignedFrom
            device   = @{ id = $device.id }
            driver   = @{ id = $driver.id }
            type     = 'Driver'
        }
    } | Out-Null

    Write-Host ("  {0,-18} -> {1}" -f $driver.name, $device.name) -ForegroundColor Green
}

$spare = $devices | Select-Object -Skip $drivers.Count

Write-Host ''
if ($WhatIf) {
    Write-Host 'Nothing was assigned (-WhatIf).' -ForegroundColor Yellow
} else {
    Write-Host "Assigned $($pairs.Count) drivers." -ForegroundColor Green
}

$pairs | Select-Object DriverCode, Driver, Vehicle, Serial | Format-Table -AutoSize | Out-String | Write-Host

if ($spare) {
    Write-Host "Unassigned spares ($($spare.Count)): $(($spare | ForEach-Object { $_.name }) -join ', ')" -ForegroundColor DarkGray
}

if (-not $WhatIf) {
    $toWrite = $pairs

    # -OnlyNew assigned a handful of drivers, so $pairs holds only those. The
    # file is meant to be the WHOLE fleet -- writing four rows over twenty-four
    # would look like sixteen drivers had lost their trucks. Merge instead,
    # letting this run's pairs win for any driver it touched.
    if ($OnlyNew -and (Test-Path $OutFile)) {
        $existingPairs = @(Get-Content $OutFile -Raw | ConvertFrom-Json)
        $justAssigned = @{}
        foreach ($p in $pairs) { $justAssigned[$p.DriverId] = $true }

        $kept = @($existingPairs | Where-Object { -not $justAssigned.ContainsKey($_.DriverId) })
        $toWrite = @($kept + $pairs) | Sort-Object Vehicle
        Write-Host ''
        Write-Host ("  merged with $OutFile -- {0} kept, {1} added" -f $kept.Count, $pairs.Count) -ForegroundColor DarkGray
    }

    $toWrite | ConvertTo-Json -Depth 4 | Set-Content -Path $OutFile -Encoding utf8
    Write-Host ''
    Write-Host "Pairing written to $OutFile -- feed this back to update the settlement unit numbers."
}
