# ---------------------------------------------------------------------------
# run-sql.ps1 -- run one batch of T-SQL against the laptop's SQL Server and
# print every result set as JSON. Dev only: tools/local-db/plugin.mjs runs
# it for the preview's "Laptop database" data.
#
# Windows authentication (Integrated Security), through the SqlClient that
# ships with Windows PowerShell -- so no password, no login to make, nothing
# to install. The SQL arrives on stdin, UTF-8.
#
# Prints ONE line of JSON:
#   { "ok": true,  "sets": [ { "columns": [...], "rows": [ {...} ] } ], "messages": [...] }
#   { "ok": false, "error": { "number": 50409, "message": "..." }, "messages": [...] }
# Every result set comes back, empty ones included, in order -- a read's
# "loads, drivers, stays" are always three sets. PRINT output is "messages".
#
# Values: a datetimeoffset keeps its offset ("2026-10-01T18:00:00-05:00");
# a datetime2 or datetime has none and gets none ("2026-09-30T13:00:00") --
# a dock's wall-clock time stays a wall-clock time, for the caller to zone.
# ---------------------------------------------------------------------------
param([string]$Database = 'mvp-techgacity')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # no "preparing modules" noise on stderr
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function ConvertTo-JsonValue($v) {
  if ($v -is [System.DBNull] -or $null -eq $v) { return $null }
  if ($v -is [System.DateTimeOffset]) { return $v.ToString("yyyy-MM-dd'T'HH:mm:sszzz", [Globalization.CultureInfo]::InvariantCulture) }
  if ($v -is [System.DateTime]) { return $v.ToString("yyyy-MM-dd'T'HH:mm:ss", [Globalization.CultureInfo]::InvariantCulture) }
  if ($v -is [System.Decimal]) { return [double]$v }
  if ($v -is [System.Guid]) { return $v.ToString() }
  if ($v -is [byte[]]) { return $null }
  return $v
}

$sql = [Console]::In.ReadToEnd()
$messages = New-Object System.Collections.ArrayList
$conn = New-Object System.Data.SqlClient.SqlConnection "Server=localhost;Database=$Database;Integrated Security=SSPI;TrustServerCertificate=True;Application Name=loadboard-local-db"
$conn.add_InfoMessage({ param($sender, $e) [void]$messages.Add($e.Message) })

try {
  $conn.Open()
  $cmd = $conn.CreateCommand()
  $cmd.CommandText = $sql
  $cmd.CommandTimeout = 60
  $reader = $cmd.ExecuteReader()
  $sets = New-Object System.Collections.ArrayList
  do {
    if ($reader.FieldCount -gt 0) {
      $columns = @()
      for ($i = 0; $i -lt $reader.FieldCount; $i++) { $columns += $reader.GetName($i) }
      $rows = New-Object System.Collections.ArrayList
      while ($reader.Read()) {
        $row = [ordered]@{}
        for ($i = 0; $i -lt $reader.FieldCount; $i++) { $row[$columns[$i]] = ConvertTo-JsonValue $reader.GetValue($i) }
        [void]$rows.Add($row)
      }
      [void]$sets.Add([ordered]@{ columns = $columns; rows = $rows.ToArray() })
    }
  } while ($reader.NextResult())
  $reader.Close()
  $out = [ordered]@{ ok = $true; sets = $sets.ToArray(); messages = $messages.ToArray() }
}
catch [System.Data.SqlClient.SqlException] {
  $err = $_.Exception
  $out = [ordered]@{ ok = $false; error = [ordered]@{ number = $err.Number; message = $err.Errors[0].Message }; messages = $messages.ToArray() }
}
catch {
  $out = [ordered]@{ ok = $false; error = [ordered]@{ number = 0; message = $_.Exception.Message }; messages = $messages.ToArray() }
}
finally {
  $conn.Close()
}
[Console]::Out.WriteLine((ConvertTo-Json -InputObject $out -Depth 8 -Compress))
