# ---------------------------------------------------------------------------
# Seed hours-of-service logs for every driver in MyGeotab.
#
# Usage:
#   $env:GEOTAB_PASSWORD = '...'          # or you will be prompted, masked
#   .\geotab-add-hos.ps1 -Database demo_millstream -WhatIf
#   .\geotab-add-hos.ps1 -Database demo_millstream
#
#   .\geotab-add-hos.ps1 -Database demo_millstream -ListLogs         # what is there
#   .\geotab-add-hos.ps1 -Database demo_millstream -Clear -WhatIf    # what -Clear would remove
#   .\geotab-add-hos.ps1 -Database demo_millstream -Only JSMITH,DFOSTER
#
# WHY THIS EXISTS. The app's "Hours of service" section reads
# DutyStatusAvailability -- how much drive, shift and cycle time each driver
# has left. Geotab computes that from DutyStatusLog entries, which come from
# the Drive app when a real driver changes status. Nobody has ever logged in
# as one of these drivers, so every clock reads "no HOS logs in GeoTab".
# This writes the logs the Drive app would have written: eight days of
# realistic duty cycles per driver, ending in a different state for each so
# the roster has somebody driving, somebody on a break, somebody off, and a
# couple of drivers close to running out of hours.
#
# WHAT IT WRITES. One DutyStatusLog per status change, origin Manual, in
# chronological order, for the last -Days days. The pattern per day is the
# ordinary one: off duty overnight, a pre-trip on duty, a driving block, a
# 30-minute break, a second driving block, a post-trip, off. Start times
# and block lengths vary by driver, deterministically from the driver's
# position in the roster, so re-running with -Clear reproduces the same
# roster every time. Two drivers (indexes 0 and 7) run near the 70-hour
# cycle limit on purpose.
#
# THIS IS THE PROJECT'S FIRST WRITE TO GEOTAB THAT IS NOT SETUP. Every
# earlier script created users, vehicles, zones and routes -- things that
# exist so the reads have something to read. Duty logs are a compliance
# record. On demo_millstream that is fine; on a real fleet this script
# would be falsifying records, and it refuses to run against a database
# whose name does not contain "demo" for exactly that reason.
#
# RULE SET. Availability is only computed for a driver with an HOS rule
# set. Drivers whose hosRuleSet is None or unset get -HosRuleSet
# (America8Day: USA property, 70 h / 8 days) before their logs are added,
# the same way geotab-add-drivers.ps1 -ApplyHosRuleSetToAll does it.
#
# WHICH TRUCK. A driving log names a device. Each driver's is the truck
# their latest DriverChange puts them in (what -ListPairing in
# geotab-assign-vehicles.ps1 shows), falling back to driver-vehicles.json.
# A driver with no truck gets logs with no device, which Geotab accepts
# for OFF/ON and refuses for D, so that driver is skipped with a warning.
#
# -Clear removes every DutyStatusLog in the window for the chosen drivers,
# then (unless -ClearOnly) writes the seed. Honours -WhatIf.
# ---------------------------------------------------------------------------

[CmdletBinding()]
param(
    [string]$Database = $env:GEOTAB_DATABASE,
    [string]$UserName = $env:GEOTAB_USER,
    [string]$Server = 'my.geotab.com',

    # How many days of history to write. Eight covers a full 70-hour cycle.
    [int]$Days = 8,

    [string]$HosRuleSet = 'America8Day',

    # Driver codes / user names to limit to (matched on the display name
    # "First Last" or the driver code from driver-vehicles.json).
    [string[]]$Only,

    # Local time zone the duty cycles are laid out in. Logs are written in UTC.
    [string]$TimeZoneId = 'Central Standard Time',

    [switch]$ListLogs,
    [switch]$Clear,
    [switch]$ClearOnly,
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'geotab-common.ps1')

if ([string]::IsNullOrWhiteSpace($Database)) { $Database = Read-Host 'MyGeotab database' }
if ([string]::IsNullOrWhiteSpace($UserName)) { $UserName = Read-Host 'MyGeotab user' }
if ($Database -notmatch 'demo') {
    throw "Refusing to seed duty status logs on '$Database': this writes compliance records and is for demo databases only. The name must contain 'demo'."
}
$password = Read-GeotabPassword -UserName $UserName

Write-Host "Authenticating to $Database ..." -ForegroundColor Cyan
$session = Connect-Geotab -Database $Database -UserName $UserName -Password $password -Server $Server
Remove-Variable password
$credentials = $session.Credentials
$api = $session.Server
Write-Host "  authenticated; using $api" -ForegroundColor Green

# --- several calls in one round trip, under the quota ----------------------
# Geotab admits 250 API calls per minute, and EVERY call inside a multicall
# counts as one -- forty adds in one request is forty against the quota.
# The first run of this script learned that at driver eleven. So the
# calls are paced: a ledger of what was sent in the last sixty seconds,
# and a wait before any chunk that would push it past the ceiling. The
# ceiling is under the limit because the Gets around the adds count too.
$script:ledger = New-Object System.Collections.Generic.List[object]
$script:ceiling = 200

function Wait-ForQuota {
    param([int]$Wanted)
    while ($true) {
        $cutoff = (Get-Date).AddSeconds(-60)
        for ($i = $script:ledger.Count - 1; $i -ge 0; $i--) { if ($script:ledger[$i].At -lt $cutoff) { $script:ledger.RemoveAt($i) } }
        $used = 0
        foreach ($e in $script:ledger) { $used += $e.Count }
        if ($used + $Wanted -le $script:ceiling) { return }
        $oldest = ($script:ledger | Sort-Object At | Select-Object -First 1).At
        $sleep = [Math]::Max(1, [int]([Math]::Ceiling(($oldest.AddSeconds(61) - (Get-Date)).TotalSeconds)))
        Write-Host ("    pausing {0}s for the API quota ({1}/{2} used this minute)" -f $sleep, $used, $script:ceiling) -ForegroundColor DarkGray
        Start-Sleep -Seconds $sleep
    }
}

function Invoke-GeotabPaced {
    param([Parameter(Mandatory)][string]$Method, [Parameter(Mandatory)][hashtable]$Params, [int]$Weight = 1)
    Wait-ForQuota -Wanted $Weight
    try {
        $r = Invoke-Geotab -ApiServer $api -Method $Method -Params $Params
    } catch {
        if ($_.Exception.Message -notmatch 'quota') { throw }
        # The ledger undercounted (a call from elsewhere, or a slow clock).
        # Wait the minute out and try once more.
        Write-Host '    quota hit; waiting 61s' -ForegroundColor DarkGray
        Start-Sleep -Seconds 61
        $script:ledger.Clear()
        $r = Invoke-Geotab -ApiServer $api -Method $Method -Params $Params
    }
    $script:ledger.Add(@{ At = Get-Date; Count = $Weight })
    return $r
}

function Invoke-GeotabMulti {
    param([Parameter(Mandatory)][object[]]$Calls)
    if ($Calls.Count -eq 0) { return @() }
    $results = @()
    # Chunked: a single failure fails the whole batch, and a smaller batch
    # names the failure more usefully; and a chunk is what the pacing above
    # waits for room for.
    for ($i = 0; $i -lt $Calls.Count; $i += 40) {
        $chunk = @($Calls[$i..([Math]::Min($i + 39, $Calls.Count - 1))])
        $results += Invoke-GeotabPaced -Method 'ExecuteMultiCall' -Weight $chunk.Count -Params @{
            calls       = $chunk
            credentials = $credentials
        }
    }
    return $results
}

# --- who ---------------------------------------------------------------------
$users = Invoke-Geotab -ApiServer $api -Method 'Get' -Params @{ typeName = 'User'; credentials = $credentials; search = @{ isDriver = $true } }
$devices = Invoke-Geotab -ApiServer $api -Method 'Get' -Params @{ typeName = 'Device'; credentials = $credentials }
$deviceById = @{}
foreach ($d in $devices) { $deviceById[$d.id] = $d }

# Latest DriverChange per driver: the truck they are in.
$changes = Invoke-Geotab -ApiServer $api -Method 'Get' -Params @{ typeName = 'DriverChange'; credentials = $credentials }
$truckOf = @{}
foreach ($c in ($changes | Sort-Object { [datetime]$_.dateTime })) {
    if ($c.driver -and $c.driver.id -and $c.device -and $c.device.id) { $truckOf[$c.driver.id] = $c.device.id }
}
# Fallback: the pairing file.
$pairingFile = Join-Path $PSScriptRoot 'driver-vehicles.json'
$codeOf = @{}
if (Test-Path $pairingFile) {
    foreach ($p in (Get-Content $pairingFile -Raw | ConvertFrom-Json)) {
        if (-not $truckOf.ContainsKey($p.DriverId)) { $truckOf[$p.DriverId] = $p.VehicleId }
        $codeOf[$p.DriverId] = $p.DriverCode
    }
}

$drivers = @($users | Sort-Object lastName, firstName)
if ($Only) {
    $want = $Only | ForEach-Object { $_.ToUpper() }
    $drivers = @($drivers | Where-Object {
        $code = $codeOf[$_.id]
        ($code -and $want -contains $code.ToUpper()) -or ($want -contains "$($_.firstName) $($_.lastName)".ToUpper())
    })
}
if ($drivers.Count -eq 0) { throw 'No matching drivers.' }
Write-Host "  $($drivers.Count) drivers" -ForegroundColor DarkGray

# --- the window --------------------------------------------------------------
$tz = [TimeZoneInfo]::FindSystemTimeZoneById($TimeZoneId)
$nowUtc = [DateTime]::UtcNow
$nowLocal = [TimeZoneInfo]::ConvertTimeFromUtc($nowUtc, $tz)
$fromLocal = $nowLocal.Date.AddDays(-$Days)
$fromUtc = [TimeZoneInfo]::ConvertTimeToUtc($fromLocal, $tz)
$iso = { param($utc) $utc.ToString('yyyy-MM-ddTHH:mm:ss.000Z') }

# --- list ----------------------------------------------------------------------
if ($ListLogs) {
    foreach ($d in $drivers) {
        $logs = Invoke-Geotab -ApiServer $api -Method 'Get' -Params @{
            typeName = 'DutyStatusLog'; credentials = $credentials
            search = @{ userSearch = @{ id = $d.id }; fromDate = (& $iso $fromUtc); toDate = (& $iso $nowUtc); includeBoundaryLogs = $true }
        }
        $latest = $logs | Sort-Object { [datetime]$_.dateTime } | Select-Object -Last 1
        $rs = if ($d.hosRuleSet) { $d.hosRuleSet } else { '(unset)' }
        Write-Host ("  {0,-24} {1,-14} {2,3} logs   latest {3}" -f "$($d.firstName) $($d.lastName)", $rs, @($logs).Count, $(if ($latest) { "$($latest.status) at $($latest.dateTime)" } else { '-' }))
    }
    return
}

# --- clear -----------------------------------------------------------------------
if ($Clear -or $ClearOnly) {
    Write-Host "Removing duty status logs since $($fromLocal.ToString('yyyy-MM-dd')) ($TimeZoneId) ..." -ForegroundColor Cyan
    foreach ($d in $drivers) {
        $logs = Invoke-Geotab -ApiServer $api -Method 'Get' -Params @{
            typeName = 'DutyStatusLog'; credentials = $credentials
            search = @{ userSearch = @{ id = $d.id }; fromDate = (& $iso $fromUtc); toDate = (& $iso $nowUtc.AddDays(1)) }
        }
        $logs = @($logs)
        if ($logs.Count -eq 0) { continue }
        if ($WhatIf) {
            Write-Host ("  would remove {0,3} logs for {1}" -f $logs.Count, "$($d.firstName) $($d.lastName)")
            continue
        }
        $calls = $logs | ForEach-Object { @{ method = 'Remove'; params = @{ typeName = 'DutyStatusLog'; entity = @{ id = $_.id } } } }
        Invoke-GeotabMulti -Calls @($calls) | Out-Null
        Write-Host ("  removed {0,3} logs for {1}" -f $logs.Count, "$($d.firstName) $($d.lastName)") -ForegroundColor Yellow
    }
    if ($ClearOnly) { return }
}

# --- the pattern -----------------------------------------------------------------
# One day's duty cycle, as (status, minutes) pairs, from a per-driver seed.
# A "heavy" driver drives close to the 11-hour limit every day and ends
# the window near the 70-hour cycle; an ordinary one drives 7-9 hours.
#
# AND ONE DAY OFF, which is the whole reason this script was revised.
#
# The first version seeded eight CONSECUTIVE working days. Each is six to
# eleven hours on duty, so the eight-day total came to somewhere between
# fifty and ninety hours against a seventy-hour cycle -- and every driver in
# the fleet ended up with a spent cycle. A spent cycle zeroes the driving
# clock with it, so /fleet showed 0m DRIVE and 0m CYCLE for the entire
# roster, which read like a bug in the app and was a bug in the data.
#
# Real carriers do not solve this by driving less. They take the 34-hour
# restart: two nights and a day off, after which the cycle starts again. A
# full calendar day with no logs gives about thirty-six hours between the
# previous evening's last OFF and the next morning's first ON, which is a
# restart, and it is what Get-RestartDay picks below. The day varies by
# driver so the fleet is not all resting on a Tuesday.
function Get-DayPlan {
    param([int]$Seed, [int]$DayIndex, [bool]$Heavy)
    $r = [System.Random]::new($Seed * 100 + $DayIndex)
    $start = 5 * 60 + $r.Next(0, 120)                 # on duty between 05:00 and 07:00
    $drive1 = if ($Heavy) { 300 + $r.Next(0, 30) } else { 180 + $r.Next(0, 120) }
    $drive2 = if ($Heavy) { 300 + $r.Next(0, 30) } else { 150 + $r.Next(0, 120) }
    return @(
        @{ Status = 'ON';  Minutes = 20 + $r.Next(0, 20) },   # pre-trip
        @{ Status = 'D';   Minutes = $drive1 },
        @{ Status = 'OFF'; Minutes = 30 + $r.Next(0, 20) },   # the break
        @{ Status = 'D';   Minutes = $drive2 },
        @{ Status = 'ON';  Minutes = 15 + $r.Next(0, 30) },   # unload, post-trip
        @{ Status = 'OFF'; Minutes = 0 }                       # off until tomorrow
    ), $start
}

# Which day of the window this driver takes off. Never the first (there
# would be nothing before it to restart from) and never the last two, so
# there are working days after the restart and the clocks on screen are the
# clocks of somebody who has been driving recently.
function Get-RestartDay {
    param([int]$Index, [int]$Days)
    if ($Days -lt 4) { return -1 }
    # Late in the window on purpose. A restart on day one leaves six working
    # days after it, and six days of a heavy driver's eleven hours is
    # seventy-two -- the cycle spent all over again, which is the bug this
    # exists to fix. Three, four or five of eight leaves at most four working
    # days: comfortably inside seventy hours even for the heavy pattern, and
    # recent enough that the clocks on screen belong to somebody who has been
    # driving this week.
    $base = [Math]::Max(1, $Days - 5)
    return $base + ($Index % 3)
}

# --- write -------------------------------------------------------------------------
Write-Host "Seeding $Days days of duty status for $($drivers.Count) drivers ..." -ForegroundColor Cyan
$totalLogs = 0
$index = 0
foreach ($d in $drivers) {
    $name = "$($d.firstName) $($d.lastName)"
    $deviceId = $truckOf[$d.id]
    if (-not $deviceId) {
        Write-Warning "  $name has no truck (no DriverChange and not in driver-vehicles.json); skipped."
        $index++
        continue
    }

    # Already seeded: leave alone, so a run that stopped part way (the quota,
    # a dropped connection) is simply run again and carries on from where it
    # got to. -Clear is the way to redo a driver.
    if (-not $Clear) {
        $have = @(Invoke-GeotabPaced -Method 'Get' -Params @{
            typeName = 'DutyStatusLog'; credentials = $credentials
            search = @{ userSearch = @{ id = $d.id }; fromDate = (& $iso $fromUtc); toDate = (& $iso $nowUtc.AddDays(1)) }
        })
        if ($have.Count -gt 0) {
            Write-Host ("  {0,-24} already has {1} logs in the window; skipped (use -Clear to redo)" -f $name, $have.Count) -ForegroundColor DarkGray
            $index++
            continue
        }
    }

    # Rule set first, or availability will never be computed.
    if (-not $d.hosRuleSet -or $d.hosRuleSet -eq 'None') {
        if ($WhatIf) {
            Write-Host ("  would set hosRuleSet {0} on {1}" -f $HosRuleSet, $name)
        } else {
            $d.hosRuleSet = $HosRuleSet
            Invoke-Geotab -ApiServer $api -Method 'Set' -Params @{ typeName = 'User'; entity = $d; credentials = $credentials } | Out-Null
            Write-Host ("  hosRuleSet -> {0} on {1}" -f $HosRuleSet, $name) -ForegroundColor DarkGray
        }
    }

    $heavy = ($index % 10) -eq 0 -or ($index % 10) -eq 7
    $restartDay = Get-RestartDay -Index $index -Days $Days
    $entries = @()
    for ($day = 0; $day -lt $Days; $day++) {
        # The restart: no logs at all for this day. The driver is still OFF
        # from the evening before, which is what makes the gap thirty-odd
        # hours rather than a gap in the record.
        if ($day -eq $restartDay) { continue }
        $dayLocal = $fromLocal.AddDays($day)
        $plan, $startMin = Get-DayPlan -Seed ($index + 1) -DayIndex $day -Heavy $heavy
        $t = $dayLocal.AddMinutes($startMin)
        foreach ($step in $plan) {
            $entries += @{ Status = $step.Status; At = $t }
            $t = $t.AddMinutes($step.Minutes)
        }
    }

    # Today: cut the plan off at "now" and leave the driver mid-state, so the
    # roster shows a mix. Which state depends on the driver, deterministically.
    $entries = @($entries | Where-Object { $_.At -lt $nowLocal })
    $endState = @('D', 'ON', 'OFF', 'D', 'SB')[$index % 5]
    $lastAt = $nowLocal.AddMinutes(-(25 + ($index * 13) % 140))
    if ($entries.Count -gt 0 -and $entries[-1].At -lt $lastAt) {
        $entries += @{ Status = $endState; At = $lastAt }
    }

    # Collapse repeats: two OFFs in a row are one.
    $clean = @()
    foreach ($e in $entries) {
        if ($clean.Count -gt 0 -and $clean[-1].Status -eq $e.Status) { continue }
        $clean += $e
    }

    if ($WhatIf) {
        $last = $clean[-1]
        Write-Host ("  would add {0,3} logs for {1,-24} ending {2} at {3:HH:mm} local{4}" -f $clean.Count, $name, $last.Status, $last.At, $(if ($heavy) { ' (heavy)' } else { '' }))
        $index++
        continue
    }

    $calls = foreach ($e in $clean) {
        @{
            method = 'Add'
            params = @{
                typeName = 'DutyStatusLog'
                entity   = @{
                    driver   = @{ id = $d.id }
                    device   = @{ id = $deviceId }
                    dateTime = (& $iso ([TimeZoneInfo]::ConvertTimeToUtc($e.At, $tz)))
                    status   = $e.Status
                    origin   = 'Manual'
                }
            }
        }
    }
    Invoke-GeotabMulti -Calls @($calls) | Out-Null
    $last = $clean[-1]
    Write-Host ("  added {0,3} logs for {1,-24} now {2}{3}" -f $clean.Count, $name, $last.Status, $(if ($heavy) { ' (heavy)' } else { '' })) -ForegroundColor Green
    $totalLogs += $clean.Count
    $index++
}

Write-Host ''
if ($WhatIf) {
    Write-Host 'Nothing was written (-WhatIf).' -ForegroundColor Yellow
} else {
    Write-Host "Wrote $totalLogs duty status logs. Availability is computed by Geotab within a minute or so; reload /fleet." -ForegroundColor Green
    Write-Host "Each driver took a 34-hour restart mid-window, so the 70-hour cycle should show hours left rather than zero." -ForegroundColor Green
}
