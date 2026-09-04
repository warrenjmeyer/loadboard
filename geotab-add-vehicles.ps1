# ---------------------------------------------------------------------------
# Add vehicles to a MyGeotab database.
#
# Usage:
#   $env:GEOTAB_PASSWORD = '...'          # or you will be prompted, masked
#   .\geotab-add-vehicles.ps1 -Database demo_millstream -Count 24 -WhatIf
#   .\geotab-add-vehicles.ps1 -Database demo_millstream -Count 24
#
#   .\geotab-add-vehicles.ps1 -Database demo_millstream -ListDevices
#
# Written because the fleet ran out of trucks. The four owner/operators in
# settlement_06_owner.sql carry units "Demo - 21" through "Demo - 24", and the
# database had only twenty vehicles -- so geotab-assign-vehicles.ps1 -OnlyNew
# correctly refused to assign anybody.
#
# THESE ARE UNTRACKED ASSETS BY DEFAULT, and that is the whole point. A normal
# Geotab device is a piece of hardware: adding one means giving the serial
# number of a GO unit somebody actually owns, and you cannot invent those. An
# untracked asset is Geotab's own answer to "I want this thing in the fleet
# list but nothing is transmitting for it" -- a trailer, a yard truck, or in
# this case a tractor that exists only in a demo database. No hardware and no
# subscription.
#
# *** READ THIS BEFORE SPENDING ANY TIME HERE. ***
#
# THIS SCRIPT DOES NOT WORK AGAINST demo_millstream, and probably not against
# your database either. It is kept because what it proves is worth keeping.
#
# Adding a vehicle needs a serial number, and a serial number cannot be
# invented. Geotab issues them: you call ProvisionDevice or
# ProvisionDeviceToAccount on the MyAdmin API -- a DIFFERENT api from the one
# every other script here uses, with its own credentials -- passing a Product
# ID, and it returns a serial. The Product ID decides the first two characters.
#
# The failures, in order, and what each one taught:
#
#   no serialNumber at all   -> "Missing serial number"
#                               Untracked or not, the field is required.
#
#   serialNumber 000-000-0021 -> "Invalid serial number: GT0-000-0021"
#                               Note the echo. Geotab rewrote the first two
#                               characters to a device-type prefix and then
#                               rejected the result, because it is not a serial
#                               it ever issued. No format will satisfy this;
#                               the number has to come FROM Geotab.
#
# So the options are: provision properly through MyAdmin (a real integration,
# needing MyAdmin credentials and a Product ID -- 10032 and 10184 are the
# documented test ones), add the assets by hand in the MyGeotab UI, or do not
# put the vehicles in Geotab at all.
#
#   https://geotab.github.io/sdk/software/guides/custom-telematics-devices/
#
# -SerialNumberFormat survives for the MyAdmin case, where real provisioned
# serials would be fed in. It is a format and not a value because serials are
# unique per device: one literal string would create the first vehicle and then
# fail on the second as a duplicate.
#
# -Count is how many vehicles should EXIST, not how many to add -- the same
# meaning it has in geotab-add-drivers.ps1. Twenty trucks and -Count 24 creates
# four; running it again creates nothing.
#
# It reads that way because the obvious alternative does not survive a second
# run. With -Count meaning "add four", the names continue from the highest
# existing number, so a re-run starts at 25 and adds Demo - 25 to Demo - 28 --
# the skip-if-it-exists check never fires, because the names it generates are
# new every time. Asking for a total is what makes the script idempotent.
#
# If Geotab rejects the Add, see the note printed on failure: some databases
# will not create devices over the API at all, and the fallback is the
# MyGeotab UI (Vehicles -> Add -> Untracked Asset).
# ---------------------------------------------------------------------------

[CmdletBinding()]
param(
    # How many vehicles should EXIST when this finishes. See the header.
    [int]$Count = 24,

    [string]$Database = $env:GEOTAB_DATABASE,
    [string]$UserName = $env:GEOTAB_USER,
    [string]$Server = 'my.geotab.com',

    # Names continue the existing series. The prefix has to match what is
    # already there or the new trucks sort away from the old ones, and
    # geotab-assign-vehicles.ps1 pairs by sorted position.
    [string]$NamePrefix = 'Demo - ',

    # Where to start numbering. Left at 0 the script reads the highest existing
    # "Demo - NN" and carries on from there, which is what you want; set it
    # only to force a particular block.
    [int]$StartNumber = 0,

    # UntrackedAsset needs no hardware. CustomVehicleDevice is the other
    # no-hardware option and behaves more like a real vehicle in some reports;
    # switch only if an untracked asset turns out not to accept a DriverChange.
    [string]$DeviceType = 'UntrackedAsset',

    [string]$CompanyGroupId = 'GroupCompanyId',

    # demo_millstream rejects an Add with "Missing serial number" even for an
    # untracked asset, so one is always sent. {0} is the vehicle's number.
    #
    # A FORMAT RATHER THAN A VALUE, because serial numbers are unique per
    # device: passing one literal string would create the first truck and then
    # fail on the second as a duplicate. Ask for four and you want four
    # serials, not the same one four times.
    #
    # If a database rejects this shape, try another -- '000-000-{0:D4}' and
    # 'UA{0:D10}' are both worth a go, and the format only has to satisfy
    # Geotab, not mean anything.
    [string]$SerialNumberFormat = '000-000-{0:D4}',

    [switch]$ListDevices,
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'geotab-common.ps1')

# --- credentials -----------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($Database)) { $Database = Read-Host 'MyGeotab database' }
if ([string]::IsNullOrWhiteSpace($UserName)) { $UserName = Read-Host 'MyGeotab user' }
$password = Read-GeotabPassword -UserName $UserName

# --- authenticate ----------------------------------------------------------
Write-Host "Authenticating to $Database ..." -ForegroundColor Cyan
$session = Connect-Geotab -Database $Database -UserName $UserName -Password $password -Server $Server
Remove-Variable password
$creds = $session.Credentials
$api = $session.Server
Write-Host "  authenticated; using $api" -ForegroundColor Green

# --- what is already there -------------------------------------------------
$devices = Invoke-Geotab -ApiServer $api -Method 'Get' -Params @{
    typeName    = 'Device'
    credentials = $creds
} | Sort-Object name

Write-Host "  $($devices.Count) vehicles already in this database" -ForegroundColor DarkGray

if ($ListDevices) {
    $devices | Select-Object name, id, deviceType, serialNumber, licensePlate |
        Format-Table -AutoSize | Out-String | Write-Host
    return
}

$existingNames = @{}
foreach ($d in $devices) { if ($d.name) { $existingNames[$d.name.ToLower()] = $true } }

# --- where to start numbering ----------------------------------------------
# Read the highest number already used under this prefix rather than assuming
# the count is the highest. Twenty vehicles named 01-20 gives 21; twenty named
# 01-18 plus two oddly-named ones still gives 19, which is the right answer.
if ($StartNumber -le 0) {
    $highest = 0
    $pattern = '^' + [regex]::Escape($NamePrefix) + '(\d+)$'
    foreach ($d in $devices) {
        if ($d.name -and $d.name -match $pattern) {
            $n = [int]$Matches[1]
            if ($n -gt $highest) { $highest = $n }
        }
    }
    $StartNumber = $highest + 1
    Write-Host "  highest existing '$NamePrefix' number is $highest; starting at $StartNumber" -ForegroundColor DarkGray
}

# --- how many are missing --------------------------------------------------
$needed = $Count - $devices.Count
if ($needed -le 0) {
    Write-Host ''
    Write-Host "Already $($devices.Count) vehicles, which meets -Count $Count. Nothing to do." -ForegroundColor Green
    return
}
Write-Host "  -Count $Count and $($devices.Count) exist, so creating $needed" -ForegroundColor DarkGray

# --- add -------------------------------------------------------------------
Write-Host ''
$created = @()
$skipped = @()
$n = $StartNumber

while ($created.Count -lt $needed) {
    $name = '{0}{1:D2}' -f $NamePrefix, $n
    $serial = $SerialNumberFormat -f $n
    $n++

    # Belt and braces. The start number is past everything under this prefix,
    # so a collision means a vehicle named outside the series -- worth stepping
    # over rather than failing on, but it must not count towards the total or
    # the run stops short.
    if ($existingNames.ContainsKey($name.ToLower())) {
        Write-Host ("  {0,-12} already exists, skipping" -f $name) -ForegroundColor DarkGray
        $skipped += $name
        continue
    }

    $entity = @{
        name         = $name
        deviceType   = $DeviceType
        serialNumber = $serial
        groups       = @(@{ id = $CompanyGroupId })
    }

    if ($WhatIf) {
        Write-Host ("  would create {0,-12} ({1}, serial {2})" -f $name, $DeviceType, $serial)
        $created += $name
        continue
    }

    try {
        Invoke-Geotab -ApiServer $api -Method 'Add' -Params @{
            typeName    = 'Device'
            entity      = $entity
            credentials = $creds
        } | Out-Null
    } catch {
        Write-Host ''
        Write-Host "Geotab refused to create $name." -ForegroundColor Red
        Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
        Write-Host ''
        if ($_.Exception.Message -match 'serial number') {
            Write-Host 'This is expected, and trying another serial format will not help.' -ForegroundColor Yellow
            Write-Host 'Geotab issues serial numbers; they cannot be made up. See the header'
            Write-Host 'of this script for the whole story, and:'
            Write-Host '  https://geotab.github.io/sdk/software/guides/custom-telematics-devices/'
            Write-Host ''
        }
        Write-Host 'What to do instead:' -ForegroundColor Yellow
        Write-Host '  - Add the vehicles by hand in MyGeotab:'
        Write-Host '      Vehicles -> Add -> Untracked Asset, named exactly as above.'
        Write-Host '    Then run geotab-assign-vehicles.ps1 -OnlyNew, which does not care'
        Write-Host '    how the vehicles got there.'
        Write-Host '  - Or provision real serials through the MyAdmin API and pass them in'
        Write-Host '    with -SerialNumberFormat. That is a separate integration.'
        Write-Host '  - Or leave Geotab alone and give the owner/operators their own unit'
        Write-Host '    numbers in the settlement data. They own the tractors; there is no'
        Write-Host '    rule saying a contractor''s truck is on the carrier''s telematics.'
        throw
    }

    Write-Host ("  created {0,-12} ({1})" -f $name, $DeviceType) -ForegroundColor Green
    $created += $name
}

# --- what happened ---------------------------------------------------------
Write-Host ''
if ($WhatIf) {
    Write-Host 'Nothing was created (-WhatIf).' -ForegroundColor Yellow
    return
}

Write-Host "Created $($created.Count) vehicles." -ForegroundColor Green
if ($skipped.Count) {
    Write-Host "Skipped $($skipped.Count) that already existed: $($skipped -join ', ')" -ForegroundColor DarkGray
}

Write-Host ''
Write-Host 'Next: give the new drivers these trucks without disturbing anyone else:' -ForegroundColor Cyan
Write-Host "  .\geotab-assign-vehicles.ps1 -Database $Database -OnlyNew -WhatIf"
Write-Host "  .\geotab-assign-vehicles.ps1 -Database $Database -OnlyNew"
