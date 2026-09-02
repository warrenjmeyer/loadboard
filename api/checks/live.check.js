// ---------------------------------------------------------------------------
// The only check that goes over real HTTP to the deployed site.
//
//   node api/checks/live.check.js [https://origin]
//
// Everything else in api/checks/ calls handlers directly, which tests the logic
// and skips the transport: routing, cookie flags, whether the platform strips
// a header, whether the function even registered. That gap is exactly where
// the 2 September outage lived -- every handler was correct and /api/loads was
// still 404 in production.
//
// It mints a real session for a throwaway admin by writing to the database,
// then presents that cookie to the live origin. Nothing is faked: the same
// procedure the login route calls, the same cookie the browser would hold.
//
// Needs SQL_* and AUTH_PEPPER, because it writes the session it then uses.
// ---------------------------------------------------------------------------
const assert = require('node:assert')
const crypto = require('node:crypto')
const { getPool, sql } = require('../src/db')
const auth = require('../src/auth')
const store = require('../src/authStore')

const ORIGIN = (process.argv[2] || 'https://wonderful-tree-0a929e80f.7.azurestaticapps.net').replace(/\/+$/, '')
const IP = '203.0.113.199'
const SUFFIX = crypto.randomUUID()

const people = {}
let passed = 0
const ok = (label) => { passed++; console.log(`  ok  ${label}`) }

async function get(path, cookie) {
  const res = await fetch(ORIGIN + path, {
    headers: cookie ? { cookie } : {},
    redirect: 'manual',
  })
  let body = null
  try {
    body = (res.headers.get('content-type') || '').includes('application/json') ? await res.json() : null
  } catch { /* not json */ }
  return { status: res.status, body }
}

async function makePerson(role, driverCode) {
  const email = `claude-live-${role}-${SUFFIX}@example.invalid`
  const created = await store.createUser(email, await auth.hashPassword('a passphrase for the live check'), `live ${role}`, IP)

  if (role !== 'none') {
    const pool = await getPool()
    await pool.request()
      .input('u', sql.Int, created.UserId)
      .input('r', sql.VarChar(20), role)
      .input('d', sql.VarChar(20), driverCode || null)
      .query('UPDATE auth.Users SET [Role]=@r, DriverCode=@d, ModifiedUtc=SYSUTCDATETIME() WHERE UserId=@u;')
  }

  const { token } = await store.createSession(created.UserId, IP, 'live-check/1.0')
  people[role] = { userId: created.UserId, cookie: `lb_session=${token}` }
  return people[role]
}

async function main() {
  assert.ok(auth.isPepperConfigured(), 'AUTH_PEPPER must be set')
  console.log(`origin ${ORIGIN}\n`)
  await getPool()

  const pool = await getPool()
  const drivers = await pool.request().query('SELECT TOP 2 driver_code FROM dbo.Drivers ORDER BY driver_code;')
  const MINE = drivers.recordset[0].driver_code
  const THEIRS = drivers.recordset[1].driver_code

  await makePerson('admin')
  await makePerson('driver', MINE)
  ok(`minted a live admin and a live driver (${MINE})`)

  // --- anonymous ----------------------------------------------------------
  let r = await get('/api/loads')
  assert.strictEqual(r.status, 200)
  assert.ok(Array.isArray(r.body) && r.body.length > 0)
  ok(`anonymous: the board is public (${r.body.length} loads)`)

  r = await get('/api/me')
  assert.strictEqual(r.status, 200)
  assert.strictEqual(r.body.user, null)
  ok('anonymous: /api/me is 200 with a null user')

  for (const path of ['/api/settlements', '/api/drivers', `/api/drivers/${MINE}/settlements`]) {
    r = await get(path)
    assert.strictEqual(r.status, 401, `${path} should be 401 when anonymous`)
  }
  ok('anonymous: every settlement route is 401')

  // --- admin, over the wire, with a real cookie ---------------------------
  r = await get('/api/me', people.admin.cookie)
  assert.strictEqual(r.status, 200)
  assert.ok(r.body.user, 'the cookie must survive the platform and reach the function')
  assert.strictEqual(r.body.user.role, 'admin')
  assert.strictEqual(r.body.user.pendingApproval, false)
  ok(`admin: /api/me reports role=${r.body.user.role}`)

  r = await get('/api/settlements', people.admin.cookie)
  assert.strictEqual(r.status, 200, JSON.stringify(r.body))
  assert.ok(Array.isArray(r.body) && r.body.length > 0)
  ok(`admin: sees the whole settlements board (${r.body.length} rows)`)

  r = await get('/api/drivers', people.admin.cookie)
  assert.strictEqual(r.status, 200)
  ok(`admin: sees the driver list (${r.body.length} drivers)`)

  r = await get(`/api/drivers/${THEIRS}/settlements`, people.admin.cookie)
  assert.strictEqual(r.status, 200)
  ok(`admin: can open any driver's statements (${THEIRS})`)

  // --- driver, over the wire ----------------------------------------------
  r = await get('/api/settlements', people.driver.cookie)
  assert.strictEqual(r.status, 403)
  ok('driver: refused the aggregate board -> 403')

  r = await get(`/api/drivers/${MINE}/settlements`, people.driver.cookie)
  assert.strictEqual(r.status, 200)
  ok(`driver: can read their own (${MINE})`)

  r = await get(`/api/drivers/${THEIRS}/settlements`, people.driver.cookie)
  assert.strictEqual(r.status, 403)
  ok(`driver: cannot read ${THEIRS} -> 403`)

  // --- a forged cookie buys nothing ---------------------------------------
  r = await get('/api/settlements', 'lb_session=' + crypto.randomBytes(32).toString('base64url'))
  assert.strictEqual(r.status, 401)
  ok('a random session token is worth nothing -> 401')

  // --- and the pages the browser needs ------------------------------------
  for (const path of ['/', '/?signin=1', '/?register=1']) {
    const res = await fetch(ORIGIN + path)
    assert.strictEqual(res.status, 200, path)
  }
  ok('the board, sign-in and register pages all serve')
}

async function cleanup() {
  const pool = await getPool()
  for (const p of Object.values(people)) {
    await pool.request().input('u', sql.Int, p.userId).input('ip', sql.VarChar(45), IP).query(`
      DELETE FROM auth.AuthEvents     WHERE UserId = @u;
      DELETE FROM auth.LoginAttempts  WHERE UserId = @u OR IpAddress = @ip;
      DELETE FROM auth.RateLimits     WHERE IpAddress = @ip;
      DELETE FROM auth.Sessions       WHERE UserId = @u;
      DELETE FROM auth.SecurityTokens WHERE UserId = @u;
      DELETE FROM auth.UserPasswords  WHERE UserId = @u;
      DELETE FROM auth.Users          WHERE UserId = @u;
    `)
  }
  const left = await pool.request()
    .query("SELECT COUNT(*) AS n FROM auth.Users WHERE Email LIKE 'claude-live-%';")
  console.log(`\ncleanup  live test users left: ${left.recordset[0].n}`)
}

if (require.main !== module) {
  module.exports = { main, cleanup }
} else {
  main()
    .then(async () => { await cleanup(); console.log(`\nALL PASS (${passed} checks)`); process.exit(0) })
    .catch(async (err) => {
      console.error(`\nFAILED: ${err.message}`)
      try { await cleanup() } catch (e) { console.error(`cleanup also failed: ${e.message}`) }
      process.exit(1)
    })
}
