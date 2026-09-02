// ---------------------------------------------------------------------------
// Exercises every query in authStore.js against a real Millstream.
//
// Named .check.js, not .test.js, on purpose: `node --test` must not pick it up.
// It needs a database and a credential, so it can never run in CI, and a suite
// that fails when it is merely unconfigured teaches people to ignore failures.
//
//   $env:SQL_SERVER   = 'millstream-wjm.database.windows.net'
//   $env:SQL_DATABASE = 'Millstream'
//   $env:SQL_USER     = 'sqlmillstream'
//   $env:SQL_PASSWORD = '...'
//   node api/src/authStore.check.js
//
// It creates one user at an @example.invalid address, drives the whole flow
// through it, and deletes every row it made. `.invalid` is reserved by RFC 2606
// precisely so it can never be a real domain, so nothing here could ever send
// mail to a stranger.
//
// The first connection can take 30-60 seconds: Millstream is serverless and
// pauses when idle.
// ---------------------------------------------------------------------------
const assert = require('node:assert')
const crypto = require('node:crypto')
const { getPool, sql } = require('./db')
const auth = require('./auth')
const store = require('./authStore')

const EMAIL = `claude-check-${crypto.randomUUID()}@example.invalid`
const NORM = EMAIL.toLowerCase()
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
  console.log(`user     ${process.env.SQL_USER}`)
  console.log(`test row ${EMAIL}\n`)

  await getPool()
  ok('connected')

  // --- create -------------------------------------------------------------
  const created = await store.createUser(EMAIL, NORM, 'Integration Check')
  userId = created.UserId
  assert.ok(userId > 0)
  assert.ok(created.PublicId)
  ok(`createUser -> UserId ${userId}, PublicId present`)

  // --- read back ----------------------------------------------------------
  let user = await store.findUserByEmail(NORM)
  assert.strictEqual(user.UserId, userId)
  assert.strictEqual(user.Role, 'none', 'a new account must be powerless')
  assert.strictEqual(user.IsActive, true)
  assert.strictEqual(user.DriverCode, null)
  assert.strictEqual(user.PasswordHash, null, 'no password until the link is used')
  assert.strictEqual(user.EmailConfirmedUtc, null)
  ok('findUserByEmail -> Role=none, IsActive=1, no password, unconfirmed')

  // --- tokens -------------------------------------------------------------
  const t1 = await store.issueToken(userId, store.PURPOSE.VERIFY, IP)
  assert.strictEqual(typeof t1, 'string')
  ok('issueToken -> raw token returned')

  // Issuing again must invalidate the first. Otherwise every request leaves
  // another working key in an inbox.
  const t2 = await store.issueToken(userId, store.PURPOSE.VERIFY, IP)
  assert.strictEqual(await store.consumeToken(store.PURPOSE.VERIFY, t1), null)
  ok('a re-issued token invalidates the previous one')

  assert.strictEqual(await store.consumeToken(store.PURPOSE.VERIFY, t2), userId)
  ok('consumeToken -> the right UserId')

  // The whole point of doing it in one UPDATE.
  assert.strictEqual(await store.consumeToken(store.PURPOSE.VERIFY, t2), null)
  ok('a consumed token cannot be spent twice')

  assert.strictEqual(await store.consumeToken(store.PURPOSE.VERIFY, 'not-a-real-token'), null)
  assert.strictEqual(await store.consumeToken(store.PURPOSE.RESET, t2), null)
  ok('a bogus token, and the right token with the wrong purpose, both fail')

  // --- passwords ----------------------------------------------------------
  const hash = await auth.hashPassword(PASSWORD)
  await store.setPassword(userId, hash)
  ok('setPassword')

  user = await store.findUserByEmail(NORM)
  assert.strictEqual(user.PasswordHash, hash)
  assert.strictEqual(user.Algorithm, 'scrypt')
  assert.ok(user.EmailConfirmedUtc, 'setting a password confirms the address')
  ok('the stored hash reads back, tagged scrypt, address now confirmed')

  assert.strictEqual(await auth.verifyPassword(PASSWORD, user.PasswordHash, user.Algorithm), true)
  assert.strictEqual(await auth.verifyPassword('wrong', user.PasswordHash, user.Algorithm), false)
  ok('the round trip verifies, and a wrong password does not')

  // Only one row may be current, no matter how many times it is set.
  await store.setPassword(userId, await auth.hashPassword('a second passphrase'))
  const pool = await getPool()
  const current = await pool
    .request()
    .input('u', sql.Int, userId)
    .query('SELECT COUNT(*) AS n FROM auth.UserPasswords WHERE UserId=@u AND IsCurrent=1')
  assert.strictEqual(current.recordset[0].n, 1)
  const history = await pool
    .request()
    .input('u', sql.Int, userId)
    .query('SELECT COUNT(*) AS n FROM auth.UserPasswords WHERE UserId=@u')
  assert.strictEqual(history.recordset[0].n, 2, 'the old password is retired, not overwritten')
  ok('exactly one current password; the previous one is kept as history')

  // --- sessions -----------------------------------------------------------
  const s1 = await store.createSession(userId, IP, 'integration-check/1.0')
  const resolved = await store.resolveSession(s1)
  assert.strictEqual(resolved.UserId, userId)
  assert.strictEqual(resolved.Role, 'none')
  ok('createSession / resolveSession round trip')

  assert.strictEqual(await store.resolveSession('not-a-session'), null)
  ok('an unknown session token resolves to nothing')

  await store.revokeSession(s1, 'signed-out')
  assert.strictEqual(await store.resolveSession(s1), null)
  ok('a revoked session stops resolving')

  // The reason sessions are rows and not JWTs.
  const s2 = await store.createSession(userId, IP, 'integration-check/1.0')
  assert.ok(await store.resolveSession(s2))
  await store.setPassword(userId, await auth.hashPassword('a third passphrase'))
  assert.strictEqual(await store.resolveSession(s2), null)
  ok('changing the password kills every live session')

  // --- attempts and rate limits -------------------------------------------
  await store.recordLoginAttempt({ userId, emailNormalized: NORM, ip: IP, succeeded: false, failureReason: 'bad-password' })
  await store.recordLoginAttempt({ userId, emailNormalized: NORM, ip: IP, succeeded: false, failureReason: 'bad-password' })
  await store.recordLoginAttempt({ userId, emailNormalized: NORM, ip: IP, succeeded: true })
  const failures = await store.recentFailures({ userId, ip: IP, minutes: 15 })
  assert.strictEqual(failures.byUser, 2, 'successes must not be counted as failures')
  assert.ok(failures.byIp >= 2)
  ok(`recentFailures -> byUser=${failures.byUser} byIp=${failures.byIp}`)

  // An unknown address must not be written down.
  await store.recordLoginAttempt({ userId: null, emailNormalized: 'stranger@example.invalid', ip: IP, succeeded: false, failureReason: 'no-such-user' })
  const leaked = await pool
    .request()
    .input('e', sql.NVarChar(320), 'stranger@example.invalid')
    .query('SELECT COUNT(*) AS n FROM auth.LoginAttempts WHERE EmailNormalized=@e')
  assert.strictEqual(leaked.recordset[0].n, 0)
  ok('an address that matched no account is not recorded')

  await store.hitRateLimit('register', NORM, IP)
  await store.hitRateLimit('register', NORM, IP)
  const limits = await store.rateLimitCount('register', NORM, IP, 60)
  assert.strictEqual(limits.bySubject, 2)
  assert.ok(limits.byIp >= 2)
  ok(`rateLimitCount -> bySubject=${limits.bySubject} byIp=${limits.byIp}`)

  await store.logEvent(userId, 'check.ran', IP, 'integration check')
  const events = await pool
    .request()
    .input('u', sql.Int, userId)
    .query('SELECT COUNT(*) AS n FROM auth.AuthEvents WHERE UserId=@u')
  assert.strictEqual(events.recordset[0].n, 1)
  ok('logEvent wrote an audit row')
}

// Children first: whether these tables cascade is not something to find out
// by assuming. Anything left behind is a test row in a live schema.
async function cleanup() {
  if (!userId) return
  const pool = await getPool()
  const r = pool.request().input('u', sql.Int, userId).input('ip', sql.VarChar(45), IP)
  await r.query(`
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
