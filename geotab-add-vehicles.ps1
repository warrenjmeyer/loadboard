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
# *** READ THIS BEFORE SPENDING ANY TIME HERE. ***
#
# Adding a vehicle needs a serial number, and the first two attempts died on
# exactly that:
#
#   no serialNumber at all   -> "Missing serial number"
#                               Untracked or not, the field is required.
#
#   serialNumber 000-000-0021 -> "Invalid serial number: GT0-000-0021"
#                               Note the echo. Geotab replaced the first two
#                               characters with the prefix belonging to the
#                               device type that was asked for -- UntrackedAsset
#                               gives GT -- and then rejected the result.
#
# What was missing was the fleet's own numbering. driver-vehicles.json, read
# back out of this database, shows the twenty existing trucks carry
# G90000000001 through G90000000020: one serial each, tracking the vehicle
# number, on the G9 prefix that belongs to a GO9. Hence the default format
# 'G9{0:D10}', which continues that series -- Demo - 21 gets G90000000021.
#
# THE SERIAL IS NOT 2T1BU4EE0DC000000. That value shows up against every
# vehicle in the MyGeotab list and reads like a shared serial, but it is
# seventeen characters and it is the VIN -- Geotab's stock demo VIN, identical
# on all twenty trucks. It is sent as -Vin, on vehicleIdentificationNumber, so
# the new trucks match the rest of the fleet there too. A serial that is the
# same on every device would be the odd thing; a VIN that is says only that
# nobody typed twenty real ones into a demo.
#
# -DeviceType and the groups are COPIED from the highest-numbered existing
# truck rather than guessed, because the guess is what produced the GT prefix
# above. Pass -DeviceType or -GroupIds to override.
#
# The groups then get filtered, and that is not fussiness:
#
#   both of Demo - 20's groups -> "Cannot add an entity with groups that have
#                                  a parent-child relationship."
#
# The existing trucks are in "Vehicle, Company Group" and Vehicle sits under
# Company Group. A device that already EXISTS may hold both -- MyGeotab lists
# the whole chain -- but Add refuses the pair, so only the deepest of any
# related set is sent. Nothing is lost by that: a parent group contains
# everything its children contain, so the truck is still in both.
#
# *** AND IT STILL DOES NOT WORK AGAINST demo_millstream. ***
#
#   the fleet's own next serial -> "Invalid serial number: G90000000021"
#
# Read that echo against the earlier one. G90000000021 came back EXACTLY as
# sent: no rewritten prefix, so the device type now agrees with the serial and
# that whole class of complaint is gone. What is left is the plain fact --
# Geotab did not issue this number, so Geotab will not take it, however
# perfectly it fits the twenty that came before it.
#
# That is worth having proven rather than assumed. The serial is not a
# formatting puzzle and never was: three shapes were tried, one of them the
# fleet's own series against the fleet's own device type, and the API refuses
# all three. Nobody needs to try a fourth.
#
# So a serial has to come FROM Geotab, and the ways to get vehicles in are:
#
#   - Add them by hand in MyGeotab: Vehicles -> Add -> Untracked Asset, named
#     exactly "Demo - 21" through "Demo - 24", in the Vehicle group. The UI can
#     do this because it provisions the serial behind the scenes; the API
#     cannot, because it makes you supply one. Then run
#     geotab-assign-vehicles.ps1 -OnlyNew, which does not care how the vehicles
#     got there. This is the cheap answer, and it is four rows.
#
#   - Provision through the MyAdmin API: ProvisionDevice or
#     ProvisionDeviceToAccount, a DIFFERENT api from the one every other script
#     here uses, with its own credentials, against a Product ID (10032 and
#     10184 are the documented test ones). Feed the serials it returns in
#     through -SerialNumberFormat, which is why that parameter survives. Real
#     integration, real credentials, for four demo trucks.
#
#   - Leave the vehicles out of Geotab. The owner/operators own their tractors;
#     there is no rule saying a contractor's truck rides on the carrier's
#     telematics.
#
#   https://geotab.github.io/sdk/software/guides/custom-telematics-devices/
#
# -SerialNumberFormat is a format rather than a value because serial numbers
# are unique per device: one literal string would create the first vehicle and
# then fail on the second as a duplicate. Pass a literal anyway if a database
# turns out not to care.
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

    # Left empty the script copies the device type of the highest-numbered
    # existing truck, which is what makes the new ones look like the old ones.
    # Set it to force a type: 'UntrackedAsset' needs no hardware, and
    # 'CustomVehicleDevice' is the other no-hardware option.
    [string]$DeviceType = '',

    # Same idea -- empty means "whatever groups the existing trucks are in".
    # The MyGeotab export shows "Vehicle, Company Group", i.e. two of them.
    [string[]]$GroupIds = @(),

    # demo_millstream rejects an Add with "Missing serial number" even for an
    # untracked asset, so one is always sent. {0} is the vehicle's number.
    #
    # The default continues the series this fleet already uses: the twenty
    # existing trucks are G90000000001 to G90000000020, so Demo - 21 becomes
    # G90000000021 and a serial still says which truck it belongs to.
    #
    # A FORMAT RATHER THAN A VALUE, because serial numbers are unique per
    # device: passing one literal string would create the first truck and then
    # fail on the second as a duplicate. Ask for four and you want four
    # serials, not the same one four times.
    [string]$SerialNumberFormat = 'G9{0:D10}',

    # The VIN, not the serial. Every vehicle in this database carries the same
    # one -- Geotab's demo VIN -- so the new trucks carry it too. Pass '' to
    # send no VIN at all.
    [string]$Vin = '2T1BU4EE0DC000000',

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
$highest = 0
$template = $null
$pattern = '^' + [regex]::Escape($NamePrefix) + '(\d+)$'
foreach ($d in $devices) {
    if ($d.name -and $d.name -match $pattern) {
        $n = [int]$Matches[1]
        if ($n -gt $highest) { $highest = $n; $template = $d }
    }
}

if ($StartNumber -le 0) {
    $StartNumber = $highest + 1
    Write-Host "  highest existing '$NamePrefix' number is $highest; starting at $StartNumber" -ForegroundColor DarkGray
}

# --- make the new trucks look like the old ones ----------------------------
# The "Invalid serial number: GT0-000-0021" rejection came from asking for a
# device type this fleet does not use: Geotab stamped that type's prefix onto
# the serial. So copy the type and the groups off the highest-numbered truck
# already here rather than guessing a second time.
if ([string]::IsNullOrWhiteSpace($DeviceType)) {
    if ($template -and $template.deviceType) {
        $DeviceType = $template.deviceType
        Write-Host "  copying deviceType '$DeviceType' from $($template.name)" -ForegroundColor DarkGray
    } else {
        $DeviceType = 'UntrackedAsset'
        Write-Host "  nothing named '$NamePrefix*' to copy; using deviceType $DeviceType" -ForegroundColor DarkGray
    }
}

if ($GroupIds.Count -eq 0) {
    if ($template -and $template.groups) {
        $GroupIds = @($template.groups | ForEach-Object { $_.id } | Where-Object { $_ })
    }
    if ($GroupIds.Count -eq 0) { $GroupIds = @('GroupCompanyId') }
    Write-Host "  groups on $($template.name): $($GroupIds -join ', ')" -ForegroundColor DarkGray
}

# --- drop the ancestors ----------------------------------------------------
# "Cannot add an entity with groups that have a parent-child relationship."
#
# The existing trucks are in "Vehicle, Company Group", and Vehicle sits UNDER
# Company Group. An existing device may hold both -- membership in the child
# implies the parent, and MyGeotab lists both -- but Add rejects the pair,
# because naming a group and its own ancestor is redundant rather than wrong.
#
# So keep only the deepest of any related pair. Vehicle survives, Company Group
# is dropped, and the truck still ends up in both: a parent group contains
# everything its children contain. This filters -GroupIds too, since a hand-
# written pair is rejected exactly the same way.
$groupTree = Invoke-Geotab -ApiServer $api -Method 'Get' -Params @{
    typeName    = 'Group'
    credentials = $creds
}

# id -> parent id. Geotab groups are a tree, so one parent each. Both shapes
# are read: Get returns children on the parent, and sometimes parent on the
# child, and which you get back varies by call.
$parentOf = @{}
foreach ($g in $groupTree) {
    if ($g.children) {
        foreach ($c in $g.children) { if ($c.id) { $parentOf[$c.id] = $g.id } }
    }
    if ($g.parent -and $g.parent.id -and -not $parentOf.ContainsKey($g.id)) {
        $parentOf[$g.id] = $g.parent.id
    }
}

function Get-GroupAncestorIds {
    param([string]$Id, [hashtable]$ParentOf)
    $out = @()
    $seen = @{}
    $cur = $ParentOf[$Id]
    # The guard is for a cycle. A tree cannot have one; a hashtable built from
    # whatever the API returned can.
    while ($cur -and -not $seen.ContainsKey($cur)) {
        $out += $cur
        $seen[$cur] = $true
        $cur = $ParentOf[$cur]
    }
    return $out
}

$deepest = @()
$dropped = @()
foreach ($id in $GroupIds) {
    $isAncestor = $false
    foreach ($other in $GroupIds) {
        if ($other -ne $id -and (Get-GroupAncestorIds -Id $other -ParentOf $parentOf) -contains $id) {
            $isAncestor = $true
            break
        }
    }
    if ($isAncestor) { $dropped += $id } else { $deepest += $id }
}

# Every group being somebody's ancestor means the map has a cycle, which a real
# group tree cannot have. Send the lot rather than sending none: an entity with
# no groups is a worse failure, and one that is visibly about groups is easier
# to read than a truck that lands nowhere.
if ($deepest.Count -eq 0) {
    Write-Host '  group tree looks circular; sending every group unfiltered' -ForegroundColor Yellow
    $deepest = $GroupIds
    $dropped = @()
}

if ($dropped.Count) {
    $names = @{}
    foreach ($g in $groupTree) { if ($g.id) { $names[$g.id] = $g.name } }
    $describe = { param($id) if ($names[$id]) { "$($names[$id]) ($id)" } else { $id } }
    Write-Host ("  dropping {0} -- a parent of {1}" -f
        (($dropped | ForEach-Object { & $describe $_ }) -join ', '),
        (($deepest | ForEach-Object { & $describe $_ }) -join ', ')) -ForegroundColor DarkGray
    $GroupIds = $deepest
}

Write-Host "  groups to send: $($GroupIds -join ', ')" -ForegroundColor DarkGray

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
        groups       = @($GroupIds | ForEach-Object { @{ id = $_ } })
    }
    if (-not [string]::IsNullOrWhiteSpace($Vin)) {
        $entity.vehicleIdentificationNumber = $Vin
    }

    if ($WhatIf) {
        Write-Host ("  would create {0,-12} ({1}, serial {2}, VIN {3})" -f $name, $DeviceType, $serial, $Vin)
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
        if ($_.Exception.Message -match 'parent-child') {
            Write-Host ("The groups sent were {0}." -f ($GroupIds -join ', ')) -ForegroundColor Yellow
            Write-Host 'Two of them are still related. The script drops ancestors it can see'
            Write-Host 'in the group tree, so this means the relationship is not visible from'
            Write-Host 'a Get of Group. Name one group explicitly:'
            Write-Host ("  .\geotab-add-vehicles.ps1 -Database {0} -GroupIds {1}" -f $Database, $GroupIds[0])
            Write-Host ''
        }
        if ($_.Exception.Message -match 'serial number') {
            Write-Host ("The serial sent was {0}, continuing this fleet's own series." -f $serial) -ForegroundColor Yellow
            Write-Host 'If Geotab echoed it back with the first characters changed, it has'
            Write-Host 'stamped a device-type prefix on and rejected the result -- that is a'
            Write-Host 'deviceType problem, not a format one, so check what the existing'
            Write-Host 'trucks are with -ListDevices. Otherwise the number simply is not one'
            Write-Host 'Geotab issued, and no shape will satisfy it. See the header, and:'
            Write-Host '  https://geotab.github.io/sdk/software/guides/custom-telematics-devices/'
            Write-Host ''
        }
        # Name every truck still missing, not just the one that failed. This is
        # a list somebody is about to retype into a web form, and "named as
        # above" only ever showed them the first of four.
        $pending = @($name)
        $m = $n
        while ($pending.Count -lt ($needed - $created.Count) -and $m -lt ($StartNumber + $needed + 50)) {
            $candidate = '{0}{1:D2}' -f $NamePrefix, $m
            $m++
            if (-not $existingNames.ContainsKey($candidate.ToLower())) { $pending += $candidate }
        }

        Write-Host 'What to do instead:' -ForegroundColor Yellow
        Write-Host '  - Add the vehicles by hand in MyGeotab:'
        Write-Host '      Vehicles -> Add -> Untracked Asset'
        Write-Host ("    Name them exactly, in the {0} group:" -f ($GroupIds -join ', '))
        foreach ($p in $pending) { Write-Host ("      {0}" -f $p) }
        Write-Host '    The UI can do this and the API cannot, because the UI provisions the'
        Write-Host '    serial for you rather than making you supply one.'
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
