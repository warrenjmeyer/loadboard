# ---------------------------------------------------------------------------
# Shared MyGeotab API helpers. Dot-source this:
#
#   . (Join-Path $PSScriptRoot 'geotab-common.ps1')
#
# Not a module, because a module would need installing or a path; a dot-sourced
# script next to its callers just works.
# ---------------------------------------------------------------------------

# Windows PowerShell 5.1 still negotiates TLS 1.0 by default on some builds,
# which Geotab refuses. Without this the first call dies with an unhelpful
# "underlying connection was closed".
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Invoke-Geotab {
    <#
        Geotab answers with HTTP 200 even when the call failed; the failure is
        an `error` object in the body. Checking only the status code means
        silently treating every rejection as success.
    #>
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

function Connect-Geotab {
    <#
        Authenticates and returns @{ Credentials = ...; Server = ... }.

        Two things this handles that a naive Authenticate does not:

        1. The federation hands you a database that lives on a specific server.
           'ThisServer' means stay put; anything else is where every later call
           must go. Missing this is the classic reason a script authenticates
           and then fails on everything after.

        2. "Incorrect login credentials" is returned both for a bad password
           and for a database this user cannot see, which makes the two
           indistinguishable. Retrying without a database separates them:
           Geotab resolves it itself when the user belongs to exactly one.
    #>
    param(
        [Parameter(Mandatory)][string]$Database,
        [Parameter(Mandatory)][string]$UserName,
        [Parameter(Mandatory)][string]$Password,
        [string]$Server = 'my.geotab.com'
    )

    $auth = $null
    try {
        $auth = Invoke-Geotab -ApiServer $Server -Method 'Authenticate' -Params @{
            userName = $UserName
            password = $Password
            database = $Database
        }
    } catch {
        Write-Host '  rejected with the database name; retrying without it...' -ForegroundColor DarkGray

        $probe = $null
        try {
            $probe = Invoke-Geotab -ApiServer $Server -Method 'Authenticate' -Params @{
                userName = $UserName
                password = $Password
            }
        } catch {
            throw "Geotab rejected $UserName. The password is wrong, or this account signs in through SSO rather than a MyGeotab password. Note the MyGeotab password is its own credential -- it is not your Microsoft account password, even though the username is the same email."
        }

        $actual = $probe.credentials.database
        throw "The password is correct, but this account is not on a database called '$Database'. Geotab resolved it to '$actual' -- re-run with -Database '$actual'."
    }

    $apiServer = $Server
    if ($auth.path -and $auth.path -ne 'ThisServer') { $apiServer = $auth.path }

    return @{ Credentials = $auth.credentials; Server = $apiServer }
}

function Get-Lanes {
    <#
        Every origin-destination pair in the project, from both places lanes
        are written down:

          settlement_0*.sql   N'DUBUQUE, IA - CHICAGO, IL'   (one literal)
          loads_02_data.sql   N'Dubuque, IA', N'Chicago, IL' (two literals)

        Both, because the two drifted apart the moment the load board grew:
        routes were built from the settlements alone and covered 7 of 32 load
        lanes. Reading one source and calling it "the lanes" is what caused
        that, so this reads all of them.

        Everything is upper-cased. The load board writes "Dubuque, IA" and the
        settlements write "DUBUQUE, IA"; zone names are matched on this, so a
        casing difference would quietly create a second Dubuque.
    #>
    param([Parameter(Mandatory)][string]$ScriptRoot)

    $files = @()
    foreach ($glob in 'settlement_0*.sql', 'loads_0*.sql') {
        $files += Get-ChildItem -Path (Join-Path $ScriptRoot $glob) -ErrorAction SilentlyContinue
    }
    if (-not $files) { throw "No settlement or load SQL found in $ScriptRoot." }

    $lanes = [ordered]@{}

    # route_detail on a settlement line: one literal, dash-separated.
    foreach ($m in (Select-String -Path $files.FullName -Pattern "N'([A-Za-z .]+, [A-Za-z]{2}) - ([A-Za-z .]+, [A-Za-z]{2})'" -AllMatches).Matches) {
        $key = ($m.Groups[1].Value + ' - ' + $m.Groups[2].Value).ToUpper()
        if (-not $lanes.Contains($key)) {
            $lanes[$key] = @{ Origin = $m.Groups[1].Value.ToUpper(); Destination = $m.Groups[2].Value.ToUpper() }
        }
    }

    # A load row: id, then origin and destination as separate literals.
    foreach ($m in (Select-String -Path $files.FullName -Pattern "\('L-\d+', N'([^']+)',\s*N'([^']+)'," -AllMatches).Matches) {
        $key = ($m.Groups[1].Value + ' - ' + $m.Groups[2].Value).ToUpper()
        if (-not $lanes.Contains($key)) {
            $lanes[$key] = @{ Origin = $m.Groups[1].Value.ToUpper(); Destination = $m.Groups[2].Value.ToUpper() }
        }
    }

    return $lanes
}

function Read-GeotabPassword {
    param([Parameter(Mandatory)][string]$UserName)

    $password = $env:GEOTAB_PASSWORD
    if ([string]::IsNullOrWhiteSpace($password)) {
        $secure = Read-Host "Password for $UserName" -AsSecureString
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        $password = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
    return $password
}
