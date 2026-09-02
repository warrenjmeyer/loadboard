// ---------------------------------------------------------------------------
// Remove the rows the check scripts created when they were loaded as Azure
// Functions and ran in a restart loop against production on 2 September 2026.
//
//   node api/checks/cleanup-strays.js            # report only, deletes nothing
//   node api/checks/cleanup-strays.js --delete   # actually remove them
//
// Deliberately narrow. It matches only the two email prefixes the checks
// generate and the ZZ- load ids, never a date range and never "everything
// created recently" -- a cleanup script that reasons about time is one clock
// skew away from deleting somebody's real account.
//
// Run the report first and read it. This is production.
// ---------------------------------------------------------------------------
const { getPool, sql } = require('../src/db')

const DELETE = process.argv.includes('--delete')

// The audit-trail IP the checks use: TEST-NET-3, reserved for documentation,
// so nothing real can ever have come from it.
const CHECK_IP = '203.0.113.199'

async function main() {
  const pool = await getPool()

  // --- what is there -------------------------------------------------------
  const users = await pool.request().query(`
    SELECT UserId, Email FROM auth.Users
    WHERE (EmailNormalized LIKE 'claude-check-%@example.invalid'
        OR EmailNormalized LIKE 'claude-authz-%@example.invalid')
      AND UserId <> 1;`)

  const loads = await pool.request().query(`
    SELECT id FROM dbo.Loads WHERE id LIKE 'ZZ-[0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F]';`)

  // A load referenced by a settlement is real freight, whatever its id looks
  // like. Checked rather than assumed, because deleting one would take a pay
  // statement's line item with it.
  const referenced = await pool.request().query(`
    SELECT DISTINCT r.load_id FROM dbo.SettlementRoutes r
    WHERE r.load_id LIKE 'ZZ-%';`)

  const audit = await pool.request().input('ip', sql.VarChar(45), CHECK_IP).query(`
    SELECT
      (SELECT COUNT(*) FROM auth.AuthEvents    WHERE IpAddress = @ip) AS events,
      (SELECT COUNT(*) FROM auth.LoginAttempts WHERE IpAddress = @ip) AS attempts,
      (SELECT COUNT(*) FROM auth.RateLimits    WHERE IpAddress = @ip) AS limits;`)

  console.log(`test users        : ${users.recordset.length}`)
  console.log(`stray ZZ- loads   : ${loads.recordset.length}`)
  console.log(`  of those, referenced by a settlement: ${referenced.recordset.length}`)
  console.log(`audit rows from ${CHECK_IP}:`)
  console.log(`  AuthEvents      : ${audit.recordset[0].events}`)
  console.log(`  LoginAttempts   : ${audit.recordset[0].attempts}`)
  console.log(`  RateLimits      : ${audit.recordset[0].limits}`)

  if (referenced.recordset.length) {
    console.log('\nREFUSING: a ZZ- load is referenced by a settlement. Investigate by hand.')
    process.exit(1)
  }

  if (!DELETE) {
    console.log('\nReport only. Re-run with --delete to remove these.')
    return
  }

  // --- remove --------------------------------------------------------------
  // Children first: every foreign key here is ON DELETE NO_ACTION, so nothing
  // cascades and the order is not optional.
  console.log('\ndeleting...')
  const r = await pool.request().input('ip', sql.VarChar(45), CHECK_IP).query(`
    SET XACT_ABORT ON;
    BEGIN TRANSACTION;

      DECLARE @ids TABLE (UserId INT PRIMARY KEY);
      INSERT INTO @ids (UserId)
      SELECT UserId FROM auth.Users
       WHERE (EmailNormalized LIKE 'claude-check-%@example.invalid'
           OR EmailNormalized LIKE 'claude-authz-%@example.invalid')
         AND UserId <> 1;

      DELETE FROM auth.AuthEvents     WHERE UserId IN (SELECT UserId FROM @ids) OR IpAddress = @ip;
      DELETE FROM auth.LoginAttempts  WHERE UserId IN (SELECT UserId FROM @ids) OR IpAddress = @ip;
      DELETE FROM auth.RateLimits     WHERE IpAddress = @ip;
      DELETE FROM auth.Sessions       WHERE UserId IN (SELECT UserId FROM @ids);
      DELETE FROM auth.SecurityTokens WHERE UserId IN (SELECT UserId FROM @ids);
      DELETE FROM auth.UserPasswords  WHERE UserId IN (SELECT UserId FROM @ids);
      DELETE FROM auth.Users          WHERE UserId IN (SELECT UserId FROM @ids);

      DELETE FROM dbo.Loads
       WHERE id LIKE 'ZZ-[0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F]';

    COMMIT TRANSACTION;

    SELECT
      (SELECT COUNT(*) FROM auth.Users
        WHERE EmailNormalized LIKE 'claude-%@example.invalid') AS users_left,
      (SELECT COUNT(*) FROM dbo.Loads WHERE id LIKE 'ZZ-%')    AS loads_left,
      (SELECT COUNT(*) FROM auth.AuthEvents WHERE IpAddress = @ip) AS events_left;`)

  const left = r.recordset[r.recordset.length - 1]
  console.log(`\nafter: test users ${left.users_left}, ZZ- loads ${left.loads_left}, audit rows ${left.events_left}`)

  const final = await pool.request().query(`
    SELECT t.name AS [table], SUM(p.[rows]) AS [rows]
    FROM sys.tables t JOIN sys.partitions p ON p.object_id=t.object_id AND p.index_id IN (0,1)
    WHERE SCHEMA_NAME(t.schema_id)='auth' GROUP BY t.name ORDER BY t.name;`)
  console.log('\nauth schema now:')
  for (const x of final.recordset) console.log(`  ${x.table.padEnd(16)} ${x.rows}`)

  const remaining = await pool.request().query('SELECT UserId, Email, [Role] FROM auth.Users ORDER BY UserId;')
  console.log('\nusers remaining:')
  for (const x of remaining.recordset) console.log(`  ${x.UserId}  ${x.Email}  role=${x.Role}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1) })
