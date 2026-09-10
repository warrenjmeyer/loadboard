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
# -Count is how many of the roster below should EXIST, not how many to create.
# Existing users are skipped, so -Count 18 when ten already exist creates the
# eight missing. Re-running never duplicates or overwrites anyone.
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

    # Password for created drivers. Falls back to GEOTAB_DRIVER_PASSWORD, and
    # then to a generated one. Deliberately not defaulted to a literal here:
    # a password written into a script is a password in every clone of the repo
    # and in its whole history.
    [string]$DriverPassword = $env:GEOTAB_DRIVER_PASSWORD,

    [switch]$ListGroups,

    # Make one new user shaped like an existing one -- the same groups, the
    # same security clearance, the same time zone and units -- with a new
    # name and address, and exit. What "a user like me" means in Geotab is
    # those things; everything else on a user is preference or history.
    #
    #   .\geotab-add-drivers.ps1 -CloneUser -NewEmail jo@example.com -NewFirstName Jo -NewLastName Pace
    #   .\geotab-add-drivers.ps1 -CloneUser -CloneFrom someone@else.com -NewEmail ... -WhatIf
    #
    # The database is in IAM mode: a user whose name is an email address sets
    # their own password from the invitation Geotab sends, so none is set
    # here. The new user is NOT a driver, whatever the template is.
    [switch]$CloneUser,
    [string]$CloneFrom,        # defaults to -UserName, i.e. yourself
    [string]$NewEmail,
    [string]$NewFirstName,
    [string]$NewLastName,

    # Apply -HosRuleSet to every existing driver and exit, creating nobody.
    [switch]$ApplyHosRuleSetToAll,

    # Set -DriverPassword on every existing driver and exit, creating nobody.
    [switch]$SetPasswordForAll,

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
$credentials = $session.Credentials
$apiServer = $session.Server
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

# --- optional: one new user shaped like an existing one --------------------
if ($CloneUser) {
    if ([string]::IsNullOrWhiteSpace($NewEmail) -or [string]::IsNullOrWhiteSpace($NewFirstName)) {
        throw 'Pass -NewEmail and -NewFirstName (and -NewLastName) with -CloneUser.'
    }
    if ($NewEmail -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { throw "'$NewEmail' is not an email address." }
    if ($existingNames.ContainsKey($NewEmail.ToLower())) { throw "$NewEmail is already a user in this database." }

    $from = if ([string]::IsNullOrWhiteSpace($CloneFrom)) { $UserName } else { $CloneFrom }
    $template = $existing | Where-Object { $_.name -and $_.name.ToLower() -eq $from.ToLower() } | Select-Object -First 1
    if (-not $template) { throw "No user named $from to clone from." }

    # Groups are a tree, and Add refuses a set that contains both a group and
    # its parent (the vehicle script learned this the hard way). Get returns
    # the whole chain on an existing user, so keep only the deepest of any
    # related pair; a parent contains everything its children contain.
    $allGroups = Invoke-Geotab -ApiServer $apiServer -Method 'Get' -Params @{ typeName = 'Group'; credentials = $credentials }
    $parentOf = @{}
    foreach ($g in $allGroups) {
        foreach ($c in $g.children) { if ($c.id) { $parentOf[$c.id] = $g.id } }
        if ($g.parent -and $g.parent.id) { $parentOf[$g.id] = $g.parent.id }
    }
    function Select-Deepest {
        param([object[]]$Groups)
        $ids = @($Groups | ForEach-Object { $_.id } | Where-Object { $_ })
        $keep = @()
        foreach ($id in $ids) {
            $isAncestor = $false
            foreach ($other in $ids) {
                $p = $parentOf[$other]
                while ($p) { if ($p -eq $id) { $isAncestor = $true; break }; $p = $parentOf[$p] }
                if ($isAncestor) { break }
            }
            if (-not $isAncestor) { $keep += @{ id = $id } }
        }
        return $keep
    }

    $entity = @{
        name           = $NewEmail
        firstName      = $NewFirstName
        lastName       = $NewLastName
        companyGroups  = @(Select-Deepest -Groups @($template.companyGroups))
        securityGroups = @(Select-Deepest -Groups @($template.securityGroups))
        timeZoneId     = $template.timeZoneId
        isMetric       = [bool]$template.isMetric
        dateFormat     = $template.dateFormat
        language       = $template.language
        activeFrom     = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.000Z')
        activeTo       = '2050-01-01T00:00:00.000Z'
        isDriver       = $false
    }
    if ($template.privateUserGroups) { $entity.privateUserGroups = @(Select-Deepest -Groups @($template.privateUserGroups)) }

    Write-Host ''
    Write-Host ("Cloning {0} -> {1} ({2} {3})" -f $template.name, $NewEmail, $NewFirstName, $NewLastName) -ForegroundColor Cyan
    Write-Host ("  company groups : {0}" -f (($entity.companyGroups | ForEach-Object { $_.id }) -join ', ')) -ForegroundColor DarkGray
    Write-Host ("  security       : {0}" -f (($entity.securityGroups | ForEach-Object { $_.id }) -join ', ')) -ForegroundColor DarkGray
    Write-Host ("  time zone      : {0}" -f $entity.timeZoneId) -ForegroundColor DarkGray

    if ($WhatIf) {
        Write-Host 'Nothing was created (-WhatIf).' -ForegroundColor Yellow
        return
    }

    $id = Invoke-Geotab -ApiServer $apiServer -Method 'Add' -Params @{
        typeName    = 'User'
        entity      = $entity
        credentials = $credentials
    }
    Write-Host ("  created {0} ({1})" -f $NewEmail, $id) -ForegroundColor Green
    Write-Host 'Geotab emails an invitation to that address; the password is set from it.'
    return
}

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

# --- optional: put every driver on the same password -----------------------
if ($SetPasswordForAll) {
    if ([string]::IsNullOrWhiteSpace($DriverPassword)) {
        throw 'Pass -DriverPassword or set $env:GEOTAB_DRIVER_PASSWORD.'
    }

    $drivers = $existing | Where-Object { $_.isDriver }
    Write-Host "Setting one password on $($drivers.Count) drivers..." -ForegroundColor Cyan

    $changed = 0
    foreach ($d in $drivers) {
        if ($WhatIf) {
            Write-Host ("  would reset {0}" -f $d.name)
            continue
        }

        # Same round-trip as the HOS update: Geotab's Set replaces the entity,
        # so send back what Get returned with one property added. Geotab never
        # returns the existing password, so this only ever sets a new one.
        $d | Add-Member -NotePropertyName password -NotePropertyValue $DriverPassword -Force
        Invoke-Geotab -ApiServer $apiServer -Method 'Set' -Params @{
            typeName    = 'User'
            entity      = $d
            credentials = $credentials
        } | Out-Null

        Write-Host ("  {0}" -f $d.name) -ForegroundColor Green
        $changed++
    }

    Write-Host ''
    if ($WhatIf) {
        Write-Host 'Nothing was changed (-WhatIf).' -ForegroundColor Yellow
    } else {
        Write-Host "Reset $changed driver password(s)." -ForegroundColor Green
        Write-Host 'Every driver now signs in with the password you supplied.'
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
    @{ First = 'Priya';   Last = 'Raman' },
    @{ First = 'Gus';     Last = 'Whitfield' },
    @{ First = 'Alma';    Last = 'Cortez' },
    @{ First = 'Desmond'; Last = 'Frye' },
    @{ First = 'Ingrid';  Last = 'Solberg' },
    @{ First = 'Terrell'; Last = 'Boone' },
    @{ First = 'Nadia';   Last = 'Pruitt' },

    # The four owner/operators (settlement_06_owner.sql). APPENDED, never
    # inserted in alphabetical order: employeeNo and licenseNumber are derived
    # from a name's INDEX in this list, so putting Brennan up with Boone would
    # renumber sixteen drivers who already have settlements against their
    # current numbers. New names go on the end, always.
    @{ First = 'Rey';     Last = 'Vasquez' },
    @{ First = 'Kit';     Last = 'Brennan' },
    @{ First = 'Miriam';  Last = 'Okonkwo' },
    @{ First = 'Lark';    Last = 'Stavros' }
)

if ($Count -gt $names.Count) {
    throw "This script carries $($names.Count) names; asked for $Count. Add more to the list rather than generating them, so re-runs stay stable."
}

# One password for every test driver. They are throwaway accounts in a test
# database; generating a different one each would mean printing a column of
# secrets to the console, which is worse.
$driverPassword = $DriverPassword
if ([string]::IsNullOrWhiteSpace($driverPassword)) {
    $driverPassword = 'TestDrv!' + (Get-Random -Minimum 100000 -Maximum 999999)
    Write-Host '  no -DriverPassword given; generating one' -ForegroundColor DarkGray
}

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
    if ([string]::IsNullOrWhiteSpace($DriverPassword)) {
        # Only echo a password we invented. Printing one the caller supplied
        # just puts their secret in the scrollback for no benefit.
        Write-Host "Generated password for all of them: $driverPassword" -ForegroundColor Yellow
        Write-Host 'Not stored anywhere. Copy it now or reset the passwords in MyGeotab.'
    } else {
        Write-Host 'They all use the password you supplied.'
    }
    Write-Host ''
    Write-Host 'The DriverCode column is what dbo.Drivers would use if you want'
    Write-Host 'settlements seeded for these drivers.'
} else {
    Write-Host 'Nothing to create -- every driver already existed.' -ForegroundColor DarkGray
}
