# ---------------------------------------------------------------------------
# Add the fleet's trailers to MyGeotab.
#
# Usage:
#   $env:GEOTAB_PASSWORD = '...'          # or you will be prompted, masked
#   .\geotab-add-trailers.ps1 -Database demo_millstream -WhatIf
#   .\geotab-add-trailers.ps1 -Database demo_millstream
#
#   .\geotab-add-trailers.ps1 -Database demo_millstream -ListTrailers
#
# The app has had trailers since fleet_01_ddl.sql (T-1xx dry vans, T-2xx
# reefers, T-3xx flatbeds), and a load names the one it is on. GeoTab never
# heard of them, which shows up in exactly one place: the Drive app asks a
# driver which trailer they are pulling and "T-206" finds nothing. This
# creates them, by the same NAME the app uses, so that screen finds them.
# Nothing in the app reads them back from GeoTab; the join is by name, like
# the trucks, for the day something does.
#
# The list comes from fleet_01_ddl.sql, read the way geotab-common.ps1's
# Get-Lanes reads the loads: the seed is the one place the fleet is written
# down, and a second copy here would drift. A trailer's type and
# description go into GeoTab's comment field, which is the only free text
# a Trailer carries.
#
# Groups: GroupCompanyId, the root, unless -GroupIds says otherwise. A
# Trailer needs at least one group and the root is always valid, which is
# simpler than the vehicle script's copy-and-filter -- there is no
# existing trailer to copy from.
#
# Re-runnable: trailers GeoTab already has, by name, are left alone.
# ---------------------------------------------------------------------------

[CmdletBinding()]
param(
    [string]$Database = $env:GEOTAB_DATABASE,
    [string]$UserName = $env:GEOTAB_USER,
    [string]$Server = 'my.geotab.com',
    [string[]]$GroupIds = @('GroupCompanyId'),
    [switch]$ListTrailers,
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
$credentials = $session.Credentials
$api = $session.Server
Write-Host "  authenticated; using $api" -ForegroundColor Green

# --- what GeoTab has -------------------------------------------------------
$existing = @(Invoke-Geotab -ApiServer $api -Method 'Get' -Params @{ typeName = 'Trailer'; credentials = $credentials })
$have = @{}
foreach ($t in $existing) { if ($t.name) { $have[$t.name.Trim().ToUpper()] = $t } }
Write-Host "  $($existing.Count) trailers already in this database" -ForegroundColor DarkGray

if ($ListTrailers) {
    $existing | Sort-Object name | ForEach-Object { Write-Host ("  {0,-10} {1,-14} {2}" -f $_.name, $_.id, $_.comment) }
    return
}

# --- what the app has ------------------------------------------------------
# One row per trailer in the MERGE seed:
#   ('T-101', N'Dry Van', N'53'' Wabash DuraPlate', 'TR 1101', N'IA', 'Active', ...)
# The description's doubled quote is SQL's escape for one quote.
$seed = Join-Path $PSScriptRoot 'sql\fleet_01_ddl.sql'
if (-not (Test-Path $seed)) { throw "sql\fleet_01_ddl.sql not found beside this script." }
$pattern = "\('(T-\d{3})',\s*N'([^']+)',\s*N'((?:[^']|'')*)'"
$wanted = @()
foreach ($m in (Select-String -Path $seed -Pattern $pattern -AllMatches).Matches) {
    $wanted += @{
        Name        = $m.Groups[1].Value
        Type        = $m.Groups[2].Value
        Description = $m.Groups[3].Value.Replace("''", "'")
    }
}
if ($wanted.Count -eq 0) { throw 'No trailer rows found in fleet_01_ddl.sql.' }
Write-Host "  $($wanted.Count) trailers in the app's seed" -ForegroundColor DarkGray

# --- add the missing ones ----------------------------------------------------
$added = 0
$skipped = 0
foreach ($t in $wanted) {
    if ($have.ContainsKey($t.Name.ToUpper())) {
        $skipped++
        continue
    }
    $comment = "$($t.Type) - $($t.Description)"
    if ($WhatIf) {
        Write-Host ("  would add {0,-8} {1}" -f $t.Name, $comment)
        $added++
        continue
    }
    $result = Invoke-Geotab -ApiServer $api -Method 'Add' -Params @{
        typeName    = 'Trailer'
        entity      = @{
            name    = $t.Name
            comment = $comment
            groups  = @($GroupIds | ForEach-Object { @{ id = $_ } })
        }
        credentials = $credentials
    }
    Write-Host ("  added {0,-8} {1}  ({2})" -f $t.Name, $comment, $result) -ForegroundColor Green
    $added++
}

Write-Host ''
if ($WhatIf) {
    Write-Host "Would add $added trailers; $skipped already present. Nothing was changed (-WhatIf)." -ForegroundColor Yellow
} else {
    Write-Host "Added $added trailers; $skipped were already there." -ForegroundColor Green
    Write-Host 'The Drive app finds them by name on its trailer screen from the next sign-in.'
}
