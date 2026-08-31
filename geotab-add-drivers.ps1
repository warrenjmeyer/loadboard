# ---------------------------------------------------------------------------
# Create test drivers in a MyGeotab database.
#
# Usage:
#   $env:GEOTAB_DATABASE = 'Millstream'
#   $env:GEOTAB_USER     = 'warrenjmeyer@live.com'
#   $env:GEOTAB_PASSWORD = '...'          # or you will be prompted, masked
#   .\geotab-add-drivers.ps1 -Count 10
#
#   .\geotab-add-drivers.ps1 -ListGroups  # print group ids and exit
#   .\geotab-add-drivers.ps1 -Count 3 -WhatIf   # show what would be created
#
# Re-running is safe: existing users are skipped, not duplicated or overwritten.
#
# These are real users in a real database. They can sign in to the Drive app.
# Point this at a test database, not production.
# ---------------------------------------------------------------------------

[CmdletBinding()]
param(
    [int]$Count = 10,

    [string]$Database = $env:GEOTAB_DATABASE,
    [string]$UserName = $env:GEOTAB_USER,

    # Authentication always starts here. Geotab replies with the server your
    # database actually lives on, and everything after that goes to it.
    [string]$Server = 'my.geotab.com',

    # .test is reserved by the IETF precisely for this: it can never be a real
    # domain, so a stray notification cannot reach a stranger's inbox.
    [string]$EmailDomain = 'millstream.test',

    # Defaults match what the existing Millstream drivers use. Run -ListGroups
    # if an Add is rejected for an unknown group -- ids vary between databases.
    [string]$SecurityGroupId = 'GroupDriveUserSecurityId',
    [string]$CompanyGroupId = 'GroupCompanyId',

    [string]$TimeZoneId = 'America/Chicago',
    [string]$LicenseProvince = 'IA',

    # Hours of service rule set. America8Day is USA Property 70-hour/8-day,
    # which is what the existing Millstream drivers use. America7Day is the
    # 60-hour/7-day variant; 'None' means the driver is not logging HOS.
    [string]$HosRuleSet = 'America8Day',

    [switch]$ListGroups,

    # Apply -HosRuleSet to every existing driver and exit, creating nobody.
    [switch]$ApplyHosRuleSetToAll,

    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1 still negotiates TLS 1.0 by default on some builds,
# which Geotab refuses. Without this the first call dies with an unhelpful
# "underlying connection was closed".
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# --- credentials -----------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($Database)) { $Database = Read-Host 'MyGeotab database' }
if ([string]::IsNullOrWhiteSpace($UserName)) { $UserName = Read-Host 'MyGeotab user' }

$password = $env:GEOTAB_PASSWORD
if ([string]::IsNullOrWhiteSpace($password)) {
    $secure = Read-Host "Password for $UserName" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $password = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

# --- transport -------------------------------------------------------------
# Geotab answers with HTTP 200 even when the call failed; the failure is an
# `error` object in the body. Checking only the status code means silently
# treating every rejection as success.
function Invoke-Geotab {
    param(
        [Parameter(Mandatory)][string]$ApiServer,
        [Parameter(Mandatory)][string]$Method,
        [Parameter(Mandatory)][hashtable]$Params
    )

    $body = @{ method = $Method; params = $Params } | ConvertTo-Json -Depth 12
    $response = Invoke-RestMethod -Method Post -Uri "https://$ApiServer/apiv1" `
        -ContentType 'application/json' -Body $body

    if ($response.PSObject.Properties.Name -contains 'error' -and $null -ne $response.error) {
        $detail = $response.error.message
        if ($response.error.errors) { $detail = $response.error.errors[0].message }
        throw "Geotab $Method failed: $detail"
    }

    return $response.result
}

# --- authenticate ----------------------------------------------------------
Write-Host "Authenticating to $Database ..." -ForegroundColor Cyan

$auth = $null
try {
    $auth = Invoke-Geotab -ApiServer $Server -Method 'Authenticate' -Params @{
        userName = $UserName
        password = $password
        database = $Database
    }
} catch {
    # "Incorrect login credentials" is returned for a bad password AND for a
    # database this user cannot see, which makes the two indistinguishable.
    # Authenticating without a database separates them: Geotab resolves it
    # itself when the user belongs to exactly one, so success here means the
    # password was fine all along and only the database name was wrong.
    Write-Host "  rejected with the database name; retrying without it..." -ForegroundColor DarkGray

    $probe = $null
    try {
        $probe = Invoke-Geotab -ApiServer $Server -Method 'Authenticate' -Params @{
            userName = $UserName
            password = $password
        }
    } catch {
        Remove-Variable password
        throw "Geotab rejected $UserName. The password is wrong, or this account signs in through SSO rather than a MyGeotab password. Note the MyGeotab password is its own credential -- it is not your Microsoft account password, even though the username is the same email."
    }

    Remove-Variable password
    $actual = $probe.credentials.database
    throw "The password is correct, but this account is not on a database called '$Database'. Geotab resolved it to '$actual' -- re-run with -Database '$actual' (or set `$env:GEOTAB_DATABASE)."
}
Remove-Variable password

$credentials = $auth.credentials

# The federation gives you a database on one of many servers. 'ThisServer'
# means stay put; anything else is where the rest of the calls must go. Missing
# this is the classic reason a script authenticates and then fails on every
# call after it.
$apiServer = $Server
if ($auth.path -and $auth.path -ne 'ThisServer') { $apiServer = $auth.path }

Write-Host "  authenticated; using $apiServer" -ForegroundColor Green

# --- optional group listing ------------------------------------------------
if ($ListGroups) {
    $groups = Invoke-Geotab -ApiServer $apiServer -Method 'Get' -Params @{
        typeName    = 'Group'
        credentials = $credentials
    }
    $groups |
        Select-Object @{n = 'id'; e = { $_.id } }, @{n = 'name'; e = { $_.name } } |
        Sort-Object name | Format-Table -AutoSize | Out-String | Write-Host
    return
}

# --- who already exists ----------------------------------------------------
# Fetch once and compare in memory. Asking Geotab per driver would be ten round
# trips to answer a question one round trip already answered.
$existing = Invoke-Geotab -ApiServer $apiServer -Method 'Get' -Params @{
    typeName    = 'User'
    credentials = $credentials
}
$existingNames = @{}
foreach ($u in $existing) { $existingNames[$u.name.ToLower()] = $true }
Write-Host "  $($existing.Count) users already in this database" -ForegroundColor DarkGray

# --- optional: fix the HOS rule set on everyone ----------------------------
if ($ApplyHosRuleSetToAll) {
    $drivers = $existing | Where-Object { $_.isDriver }
    Write-Host "Setting hosRuleSet to $HosRuleSet on $($drivers.Count) drivers..." -ForegroundColor Cyan

    $changed = 0
    foreach ($d in $drivers) {
        if ($d.hosRuleSet -eq $HosRuleSet) {
            Write-Host ("  {0,-34} already {1}" -f $d.name, $HosRuleSet) -ForegroundColor DarkGray
            continue
        }

        $was = $d.hosRuleSet
        if (-not $was) { $was = '(unset)' }

        if ($WhatIf) {
            Write-Host ("  would change {0,-30} {1} -> {2}" -f $d.name, $was, $HosRuleSet)
            continue
        }

        # Geotab's Set replaces the whole entity, so send back the object that
        # came from Get with one property changed. Building a fresh entity with
        # only hosRuleSet would blank out everything omitted -- groups, licence,
        # active dates, the lot.
        $d.hosRuleSet = $HosRuleSet
        Invoke-Geotab -ApiServer $apiServer -Method 'Set' -Params @{
            typeName    = 'User'
            entity      = $d
            credentials = $credentials
        } | Out-Null

        Write-Host ("  {0,-34} {1} -> {2}" -f $d.name, $was, $HosRuleSet) -ForegroundColor Green
        $changed++
    }

    Write-Host ''
    if ($WhatIf) {
        Write-Host 'Nothing was changed (-WhatIf).' -ForegroundColor Yellow
    } else {
        Write-Host "Updated $changed driver(s)." -ForegroundColor Green
    }
    return
}

# --- the drivers to create -------------------------------------------------
# Fixed list rather than random: re-running produces the same people, so the
# settlements seeded against them stay valid.
$names = @(
    @{ First = 'Dale';    Last = 'Foster' },
    @{ First = 'Marcus';  Last = 'Webb' },
    @{ First = 'Tanya';   Last = 'Ruiz' },
    @{ First = 'Everett'; Last = 'Klein' },
    @{ First = 'Rosa';    Last = 'Delgado' },
    @{ First = 'Hollis';  Last = 'Barnett' },
    @{ First = 'Junior';  Last = 'Pace' },
    @{ First = 'Wanda';   Last = 'Yates' },
    @{ First = 'Cyrus';   Last = 'Nolan' },
    @{ First = 'Lena';    Last = 'Hartman' },
    @{ First = 'Otis';    Last = 'Vaughn' },
    @{ First = 'Priya';   Last = 'Raman' }
)

if ($Count -gt $names.Count) {
    throw "This script carries $($names.Count) names; asked for $Count. Add more to the list rather than generating them, so re-runs stay stable."
}

# One password for every test driver. They are throwaway accounts in a test
# database; generating ten different ones would mean printing ten secrets to
# the console, which is worse.
$driverPassword = 'TestDrv!' + (Get-Random -Minimum 100000 -Maximum 999999)

$created = @()
$skipped = @()

for ($i = 0; $i -lt $Count; $i++) {
    $first = $names[$i].First
    $last = $names[$i].Last
    $email = ('{0}.{1}@{2}' -f $first, $last, $EmailDomain).ToLower()
    $employeeNo = '9{0:D5}' -f (1 + $i)

    if ($existingNames.ContainsKey($email)) {
        $skipped += $email
        continue
    }

    $entity = @{
        name            = $email
        firstName       = $first
        lastName        = $last
        password        = $driverPassword
        isDriver        = $true
        employeeNo      = $employeeNo
        licenseNumber   = '5{0:D9}' -f (412255000 + $i)
        licenseProvince = $LicenseProvince
        timeZoneId      = $TimeZoneId
        hosRuleSet      = $HosRuleSet

        # activeTo has to be a real future date. Leave it out and the user is
        # created already expired, which shows up as a driver who cannot log in
        # and no obvious reason why.
        activeFrom      = '2020-01-01T00:00:00.000Z'
        activeTo        = '2050-01-01T00:00:00.000Z'

        securityGroups  = @(@{ id = $SecurityGroupId })
        companyGroups   = @(@{ id = $CompanyGroupId })
        driverGroups    = @(@{ id = $CompanyGroupId })
    }

    if ($WhatIf) {
        Write-Host ("  would create {0,-34} {1} {2}  emp {3}" -f $email, $first, $last, $employeeNo)
        continue
    }

    Invoke-Geotab -ApiServer $apiServer -Method 'Add' -Params @{
        typeName    = 'User'
        entity      = $entity
        credentials = $credentials
    } | Out-Null

    $created += [pscustomobject]@{
        Email      = $email
        FirstName  = $first
        LastName   = $last
        EmployeeNo = $employeeNo
        DriverCode = ($first.Substring(0, 1) + $last).ToUpper()
    }
    Write-Host ("  created {0,-34} {1}" -f $email, $employeeNo) -ForegroundColor Green
}

# --- what happened ---------------------------------------------------------
Write-Host ''
if ($WhatIf) {
    Write-Host 'Nothing was created (-WhatIf).' -ForegroundColor Yellow
    return
}

if ($skipped.Count) {
    Write-Host "Skipped $($skipped.Count) already present:" -ForegroundColor DarkGray
    $skipped | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
}

if ($created.Count) {
    Write-Host "Created $($created.Count) drivers." -ForegroundColor Green
    $created | Format-Table -AutoSize | Out-String | Write-Host
    Write-Host "Shared password for all of them: $driverPassword" -ForegroundColor Yellow
    Write-Host 'Not stored anywhere. Copy it now or reset the passwords in MyGeotab.'
    Write-Host ''
    Write-Host 'The DriverCode column is what dbo.Drivers would use if you want'
    Write-Host 'settlements seeded for these drivers.'
} else {
    Write-Host 'Nothing to create -- every driver already existed.' -ForegroundColor DarkGray
}
