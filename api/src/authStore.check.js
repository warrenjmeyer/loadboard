// ---------------------------------------------------------------------------
// Exercises every stored-procedure wrapper in authStore.js against a real
// Millstream.
//
// Named .check.js, not .test.js, on purpose: `node --test` must not pick it up.
// It needs a database and two secrets, so it can never run in CI, and a suite
// that fails when it is merely unconfigured teaches people to ignore failures.
//
//   $env:SQL_SERVER / SQL_DATABASE / SQL_USER / SQL_PASSWORD
//   $env:AUTH_PEPPER      -- must match app-scaffold's config/env.json
//   node api/src/authStore.check.js
//
// It creates one user at an @example.invalid address -- reserved by RFC 2606,
// so it can never be a real domain and nothing here could mail a stranger --
// drives the whole flow through it, and deletes every row it made.
//
// The first connection can take 30-60 seconds: Millstream is serverless.
// ---------------------------------------------------------------------------
const assert = require('node:assert')
const crypto = require('node:crypto')
const { getPool, sql } = require('./db')
const auth = require('./auth')
const store = require('./authStore')

const EMAIL = `claude-check-${crypto.randomUUID()}@example.invalid`
const IP = '203.0.113.199' // TEST-NET-3, reserved for documentation
const PASSWORD = 'a passphrase for the integration check'

let userId = null
let passed = 0

function ok(label) {
  passed++
  console.log(`  ok  ${label}`)
}

async function main() {
  console.log(`server   ${process.env.SQL_SERVER}`)
  console.log(`database ${process.env.SQL_DATABASE}`)
  console.log(`pepper   ${auth.isPepperConfigured() ? 'configured' : 'MISSING'}`)
  console.log(`test row ${EMAIL}\n`)

  assert.ok(auth.isPepperConfigured(), 'AUTH_PEPPER must be set, or hashes will not match ColdFusion')

  await getPool()
  ok('connected')

  // --- create -------------------------------------------------------------
  // usp_User_Create takes the password hash up front and writes the user, the
  // password and the audit row in one transaction. So registration collects a
  // password immediately and the emailed link confirms the ADDRESS -- which is
  // what register.cfm already does. There is no password-less user state.
  const hash = await auth.hashPassword(PASSWORD)
  const created = await store.createUser(EMAIL, hash, 'Integration Check', IP)
  userId = created.UserId
  assert.ok(userId > 0)
  assert.ok(created.PublicId)
  ok(`createUser -> UserId ${userId}, PublicId present`)

  // --- read back ----------------------------------------------------------
  const u = await store.getUserForLogin(EMAIL)
  assert.strictEqual(u.UserId, userId)
  assert.strictEqual(u.IsActive, true)
  assert.strictEqual(u.IsLockedOut, false)
  assert.strictEqual(u.EmailConfirmedUtc, null, 'unconfirmed until the link is used')
  assert.strictEqual(u.Algorithm, 'bcrypt-12')
  assert.strictEqual(u.PasswordHash, hash)
  ok('getUserForLogin -> active, unlocked, unconfirmed, bcrypt-12')

  // The stored hash verifies, which is the whole interop claim.
  assert.strictEqual(await auth.verifyPassword(PASSWORD, u.PasswordHash, u.Algorithm), true)
  assert.strictEqual(await auth.verifyPassword('wrong', u.PasswordHash, u.Algorithm), false)
  ok('the hash written through the procedure verifies here')

  // --- authorization ------------------------------------------------------
  const authz = await store.getAuthorization(userId)
  assert.strictEqual(authz.Role, 'none', 'a new account must be powerless')
  assert.strictEqual(authz.DriverCode, null)
  ok('getAuthorization -> Role=none, no DriverCode')

  // --- tokens -------------------------------------------------------------
  const t1 = await store.issueToken(userId, store.PURPOSE.VERIFY, IP)
  assert.strictEqual(typeof t1, 'string')
  ok('issueToken -> raw token returned')

  const redeemed = await store.redeemToken(store.PURPOSE.VERIFY, t1)
  assert.ok(redeemed, 'a fresh token must redeem')
  assert.strictEqual(redeemed.UserId, userId)
  ok('redeemToken -> the right UserId')

  assert.strictEqual(await store.redeemToken(store.PURPOSE.VERIFY, t1), null)
  ok('a redeemed token cannot be spent twice')

  const t2 = await store.issueToken(userId, store.PURPOSE.RESET, IP)
  assert.strictEqual(await store.redeemToken(store.PURPOSE.VERIFY, t2), null)
  assert.ok(await store.redeemToken(store.PURPOSE.RESET, t2))
  ok('a token is only valid for the purpose it was issued for')

  assert.strictEqual(await store.redeemToken(store.PURPOSE.RESET, 'not-a-real-token'), null)
  ok('a bogus token redeems to nothing')

  // --- email confirmation -------------------------------------------------
  await store.confirmEmail(userId, IP)
  assert.ok((await store.getUserForLogin(EMAIL)).EmailConfirmedUtc, 'now confirmed')
  ok('confirmEmail sets EmailConfirmedUtc')

  // --- sessions -----------------------------------------------------------
  const { token: s1, session } = await store.createSession(userId, IP, 'integration-check/1.0')
  assert.ok(session.SessionId)
  const valid = await store.validateSession(s1)
  assert.ok(valid, 'a fresh session must validate')
  assert.strictEqual(valid.UserId, userId)
  ok(`createSession / validateSession round trip (SessionId ${session.SessionId})`)

  assert.strictEqual(await store.validateSession('not-a-session'), null)
  ok('an unknown session token validates to nothing')

  await store.revokeSession(s1, 'Logout', IP)
  assert.strictEqual(await store.validateSession(s1), null)
  ok('a revoked session stops validating')

  // The reason sessions are rows and not JWTs.
  const { token: s2 } = await store.createSession(userId, IP, 'integration-check/1.0')
  assert.ok(await store.validateSession(s2))
  await store.setPassword(userId, await auth.hashPassword('a different passphrase'), { ip: IP })
  assert.strictEqual(await store.validateSession(s2), null)
  ok('changing the password revokes every live session')

  const after = await store.getUserForLogin(EMAIL)
  assert.strictEqual(await auth.verifyPassword('a different passphrase', after.PasswordHash, after.Algorithm), true)
  assert.strictEqual(await auth.verifyPassword(PASSWORD, after.PasswordHash, after.Algorithm), false)
  ok('the new password verifies and the old one does not')

  // Exactly one current password, with the old ones kept as history.
  const pool = await getPool()
  const rows = await pool
    .request()
    .input('u', sql.Int, userId)
    // CURRENT is a reserved word in T-SQL, hence the brackets.
    .query(`SELECT COUNT(*) AS total,
                   SUM(CASE WHEN IsCurrent = 1 THEN 1 ELSE 0 END) AS [current]
            FROM auth.UserPasswords WHERE UserId = @u;`)
  assert.strictEqual(rows.recordset[0].current, 1)
  assert.strictEqual(rows.recordset[0].total, 2, 'the old password is retired, not overwritten')
  ok('exactly one current password; the previous one kept as history')

  // --- throttling ---------------------------------------------------------
  const before = await store.getThrottleState(EMAIL, IP)
  assert.strictEqual(Number(before.FailuresForEmail), 0)
  ok(`getThrottleState -> email=${before.FailuresForEmail} ip=${before.FailuresForIp}`)

  await store.recordLoginAttempt({ email: EMAIL, ip: IP, succeeded: false, userId, failureReason: 'BadPassword' })
  await store.recordLoginAttempt({ email: EMAIL, ip: IP, succeeded: false, userId, failureReason: 'BadPassword' })
  const mid = await store.getThrottleState(EMAIL, IP)
  assert.strictEqual(Number(mid.FailuresForEmail), 2)
  ok(`two failures counted -> email=${mid.FailuresForEmail} ip=${mid.FailuresForIp}`)

  // The procedure excludes the app's own throttle rejections, so a locked-out
  // person retrying cannot extend their own lockout.
  await store.recordLoginAttempt({ email: EMAIL, ip: IP, succeeded: false, userId, failureReason: 'EmailThrottled' })
  const afterThrottle = await store.getThrottleState(EMAIL, IP)
  assert.strictEqual(Number(afterThrottle.FailuresForEmail), 2, 'throttle rejections must not re-arm the throttle')
  ok('a throttle rejection is recorded but not counted')

  await store.recordLoginAttempt({ email: EMAIL, ip: IP, succeeded: true, userId })
  ok('a successful attempt records')

  // --- rate limits --------------------------------------------------------
  const rl = await store.hitRateLimit('register', EMAIL, IP)
  assert.ok(rl, 'usp_RateLimit_Hit returns a state row')
  ok(`hitRateLimit -> ${JSON.stringify(rl)}`)
}

// Children first: the foreign keys are ON DELETE NO_ACTION, so nothing
// cascades. Anything left behind is a test row in a live schema.
async function cleanup() {
  if (!userId) return
  const pool = await getPool()
  await pool
    .request()
    .input('u', sql.Int, userId)
    .input('ip', sql.VarChar(45), IP)
    .query(`
      DELETE FROM auth.AuthEvents     WHERE UserId = @u;
      DELETE FROM auth.LoginAttempts  WHERE UserId = @u OR IpAddress = @ip;
      DELETE FROM auth.RateLimits     WHERE IpAddress = @ip;
      DELETE FROM auth.Sessions       WHERE UserId = @u;
      DELETE FROM auth.SecurityTokens WHERE UserId = @u;
      DELETE FROM auth.UserPasswords  WHERE UserId = @u;
      DELETE FROM auth.Users          WHERE UserId = @u;
    `)

  const left = await pool
    .request()
    .input('u', sql.Int, userId)
    .query('SELECT COUNT(*) AS n FROM auth.Users WHERE UserId = @u')
  console.log(`\ncleanup  removed test user ${userId} (rows remaining: ${left.recordset[0].n})`)
}

main()
  .then(async () => {
    await cleanup()
    console.log(`\nALL PASS (${passed} checks)`)
    process.exit(0)
  })
  .catch(async (err) => {
    console.error(`\nFAILED: ${err.message}`)
    try {
      await cleanup()
    } catch (e) {
      console.error(`cleanup also failed: ${e.message} -- user ${userId} may remain`)
    }
    process.exit(1)
  })
