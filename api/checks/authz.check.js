// ---------------------------------------------------------------------------
// The authorization matrix, against a real Millstream.
//
// Every cell below is a question of the form "can THIS person reach THAT?",
// and the wrong answer in either direction is a bug worth catching: a false
// deny is an annoyance, a false allow hands one driver another's pay.
//
//   $env:SQL_SERVER / SQL_DATABASE / SQL_USER / SQL_PASSWORD
//   $env:AUTH_PEPPER
//   node api/src/functions/authz.check.js
// ---------------------------------------------------------------------------
const assert = require('node:assert')
const crypto = require('node:crypto')
const { app } = require('@azure/functions')

// Capture the handlers as the modules register them. app.http is a no-op in
// test mode, so intercepting it is the only way to reach handlers that are
// otherwise defined inline -- and it means settlements.js needs no edit purely
// to be testable.
const handlers = {}

// Deliberately NOT at module scope. Replacing app.http is exactly what broke
// production when this file was loaded as a function, so it happens inside a
// call that only the direct-execution path makes.
function captureHandlers() {
  const realHttp = app.http.bind(app)
  app.http = (name, opts) => { handlers[name] = opts.handler }
  try {
    require('../src/functions/loads')
    require('../src/functions/settlements')
  } finally {
    app.http = realHttp
  }
}

const { getPool, sql } = require('../src/db')
const auth = require('../src/auth')
const store = require('../src/authStore')

const IP = '203.0.113.199'
const PASSWORD = 'a long enough passphrase for authz'
const SUFFIX = crypto.randomUUID()
const TEST_LOAD_ID = `ZZ-${SUFFIX.slice(0, 6).toUpperCase()}`

const people = {}   // role -> { userId, email, cookie }
let passed = 0
const ok = (label) => { passed++; console.log(`  ok  ${label}`) }

const ctx = { error: (...a) => console.log('    [ctx.error]', ...a), log: () => {} }

function req({ cookie = null, body = null, params = {}, method = 'GET' } = {}) {
  const headers = { 'x-forwarded-for': IP, 'user-agent': 'authz-check/1.0', ...(cookie ? { cookie } : {}) }
  return {
    method,
    params,
    headers: { get: (n) => headers[n.toLowerCase()] ?? null },
    json: async () => body,
  }
}

async function makePerson(role, driverCode) {
  const email = `claude-authz-${role}-${SUFFIX}@example.invalid`
  const created = await store.createUser(email, await auth.hashPassword(PASSWORD), `authz ${role}`, IP)

  if (role !== 'none') {
    // Role and DriverCode move together: CK_Users_DriverCode requires a driver
    // to have a code and everyone else not to have one.
    const pool = await getPool()
    await pool.request()
      .input('u', sql.Int, created.UserId)
      .input('r', sql.VarChar(20), role)
      .input('d', sql.VarChar(20), driverCode || null)
      .query('UPDATE auth.Users SET [Role] = @r, DriverCode = @d, ModifiedUtc = SYSUTCDATETIME() WHERE UserId = @u;')
  }

  const { token } = await store.createSession(created.UserId, IP, 'authz-check/1.0')
  people[role] = { userId: created.UserId, email, cookie: `lb_session=${token}` }
  return people[role]
}

async function main() {
  assert.ok(auth.isPepperConfigured(), 'AUTH_PEPPER must be set')
  captureHandlers()
  await getPool()

  // A real driver code, because auth.Users.DriverCode has a foreign key to
  // dbo.Drivers and a made-up one would be rejected.
  const pool = await getPool()
  const drivers = await pool.request().query('SELECT TOP 2 driver_code FROM dbo.Drivers ORDER BY driver_code;')
  assert.ok(drivers.recordset.length >= 2, 'need two drivers to test cross-driver access')
  const MINE = drivers.recordset[0].driver_code
  const THEIRS = drivers.recordset[1].driver_code
  console.log(`driver codes: mine=${MINE} theirs=${THEIRS}\n`)

  await makePerson('none')
  await makePerson('driver', MINE)
  await makePerson('dispatcher')
  await makePerson('admin')
  ok('created a pending, a driver, a dispatcher and an admin')

  // --- GET /api/loads stays public ----------------------------------------
  let r = await handlers.loads(req(), ctx)
  assert.strictEqual(r.status, undefined, 'GET /api/loads must not have become gated')
  assert.ok(Array.isArray(r.jsonBody))
  ok('GET /api/loads is still public')

  // --- POST /api/loads ----------------------------------------------------
  const newLoad = {
    id: TEST_LOAD_ID, origin: 'Testville, IA', destination: 'Checkton, NE',
    miles: 120, rate: 500, equipment: 'Dry Van',
  }

  r = await handlers.loads(req({ method: 'POST', body: newLoad }), ctx)
  assert.strictEqual(r.status, 401, 'anonymous POST must be refused')
  ok('anonymous cannot add a load -> 401')

  r = await handlers.loads(req({ method: 'POST', body: newLoad, cookie: people.none.cookie }), ctx)
  assert.strictEqual(r.status, 403)
  assert.match(r.jsonBody.error, /waiting for approval/i, 'a pending account is told why')
  ok('a pending account cannot add a load -> 403, told it is pending')

  r = await handlers.loads(req({ method: 'POST', body: newLoad, cookie: people.driver.cookie }), ctx)
  assert.strictEqual(r.status, 403)
  assert.match(r.jsonBody.error, /permission/i)
  ok('a driver cannot add a load -> 403')

  r = await handlers.loads(req({ method: 'POST', body: newLoad, cookie: people.dispatcher.cookie }), ctx)
  assert.strictEqual(r.status, 201, JSON.stringify(r.jsonBody))
  assert.strictEqual(r.jsonBody.id, TEST_LOAD_ID)
  assert.strictEqual(r.jsonBody.status, 'Available')
  ok('a dispatcher CAN add a load -> 201')

  // --- aggregate settlement views -----------------------------------------
  for (const [who, cookie, expected] of [
    ['anonymous', null, 401],
    ['a pending account', people.none.cookie, 403],
    ['a driver', people.driver.cookie, 403],
  ]) {
    r = await handlers.settlementBoard(req({ cookie }), ctx)
    assert.strictEqual(r.status, expected, `${who} on /api/settlements`)
    r = await handlers.driverList(req({ cookie }), ctx)
    assert.strictEqual(r.status, expected, `${who} on /api/drivers`)
  }
  ok('anonymous 401, pending 403, driver 403 on both aggregate views')

  r = await handlers.settlementBoard(req({ cookie: people.dispatcher.cookie }), ctx)
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.ok(Array.isArray(r.jsonBody))
  ok(`a dispatcher sees the settlements board (${r.jsonBody.length} rows)`)

  // Admin was untested until 2026-09-02. It is the role Warren actually holds,
  // which makes it the one role where being wrong is guaranteed to be noticed.
  r = await handlers.settlementBoard(req({ cookie: people.admin.cookie }), ctx)
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.ok(Array.isArray(r.jsonBody) && r.jsonBody.length > 0)
  ok(`an ADMIN sees the settlements board (${r.jsonBody.length} rows)`)

  r = await handlers.driverList(req({ cookie: people.admin.cookie }), ctx)
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.ok(Array.isArray(r.jsonBody) && r.jsonBody.length > 0)
  ok(`an ADMIN sees the driver list (${r.jsonBody.length} drivers)`)

  r = await handlers.settlementList(req({ cookie: people.admin.cookie, params: { driverCode: THEIRS } }), ctx)
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  ok(`an ADMIN can open any driver's statements (${THEIRS})`)

  r = await handlers.loads(req({ method: 'POST', body: { ...newLoad, id: TEST_LOAD_ID + 'A' }, cookie: people.admin.cookie }), ctx)
  assert.strictEqual(r.status, 201, JSON.stringify(r.jsonBody))
  ok('an ADMIN can add a load')

  // --- one driver's statement ---------------------------------------------
  const listReq = (cookie, code) => req({ cookie, params: { driverCode: code } })

  r = await handlers.settlementList(listReq(null, MINE), ctx)
  assert.strictEqual(r.status, 401)
  ok(`anonymous cannot read ${MINE}'s settlements -> 401`)

  r = await handlers.settlementList(listReq(people.driver.cookie, MINE), ctx)
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.ok(Array.isArray(r.jsonBody))
  ok(`a driver CAN read their own settlements (${r.jsonBody.length} rows)`)

  // The one that matters most.
  r = await handlers.settlementList(listReq(people.driver.cookie, THEIRS), ctx)
  assert.strictEqual(r.status, 403, 'a driver must not read another driver')
  ok(`a driver CANNOT read ${THEIRS}'s settlements -> 403`)

  // Case must not be a way around it.
  r = await handlers.settlementList(listReq(people.driver.cookie, THEIRS.toLowerCase()), ctx)
  assert.strictEqual(r.status, 403)
  r = await handlers.settlementList(listReq(people.driver.cookie, MINE.toLowerCase()), ctx)
  assert.strictEqual(r.status, undefined)
  ok('the driver-code comparison is case-insensitive in both directions')

  r = await handlers.settlementList(listReq(people.dispatcher.cookie, THEIRS), ctx)
  assert.strictEqual(r.status, undefined)
  ok('a dispatcher can read any driver')

  r = await handlers.settlementList(listReq(people.none.cookie, MINE), ctx)
  assert.strictEqual(r.status, 403)
  ok('a pending account cannot read anyone -> 403')

  // --- the detail route, same rules ---------------------------------------
  const anyDate = (await pool.request().input('d', sql.VarChar(20), MINE)
    .query('SELECT TOP 1 CONVERT(char(10), check_date, 23) AS d FROM dbo.Settlements WHERE driver_code = @d ORDER BY check_date DESC;'))
    .recordset[0]

  if (anyDate) {
    const detailReq = (cookie, code) => req({ cookie, params: { driverCode: code, checkDate: anyDate.d } })

    r = await handlers.settlementDetail(detailReq(null, MINE), ctx)
    assert.strictEqual(r.status, 401)
    r = await handlers.settlementDetail(detailReq(people.driver.cookie, THEIRS), ctx)
    assert.strictEqual(r.status, 403)
    r = await handlers.settlementDetail(detailReq(people.driver.cookie, MINE), ctx)
    assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
    ok(`the detail route enforces the same rule (${MINE} on ${anyDate.d})`)
  } else {
    ok('no settlements for that driver; detail route check skipped')
  }

  // --- a revoked session loses everything immediately ---------------------
  await store.revokeSession(people.dispatcher.cookie.split('=')[1], 'Logout', IP)
  r = await handlers.settlementBoard(req({ cookie: people.dispatcher.cookie }), ctx)
  assert.strictEqual(r.status, 401, 'revoking a session must take effect at once')
  ok('a revoked session loses access immediately, not at expiry')
}

async function cleanup() {
  const pool = await getPool()
  const ids = Object.values(people).map((p) => p.userId).filter(Boolean)

  await pool.request().input('id', sql.VarChar(20), TEST_LOAD_ID)
    .query("DELETE FROM dbo.Loads WHERE id = @id OR id = @id + 'A';")

  for (const id of ids) {
    await pool.request().input('u', sql.Int, id).input('ip', sql.VarChar(45), IP).query(`
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
    .query(`SELECT (SELECT COUNT(*) FROM auth.Users WHERE Email LIKE 'claude-authz-%') AS users,
                   (SELECT COUNT(*) FROM dbo.Loads WHERE id LIKE 'ZZ-%') AS loads;`)
  console.log(`\ncleanup  test users left: ${left.recordset[0].users}, test loads left: ${left.recordset[0].loads}`)
}

// ---------------------------------------------------------------------------
// Only run when executed directly, never when required.
//
// This guard exists because its absence took the production API down. These
// files used to live in api/src/functions/, which package.json globs as
// "src/functions/*.js" -- so Azure loaded them as if they were functions, ran
// main() against the live database, and called process.exit() inside the
// Functions host. authz.check.js additionally replaces app.http to capture
// handlers rather than register them, and it sorts before loads.js, so
// /api/loads and every settlement route were swallowed and never registered.
//
// Moving them out of that folder is the real fix. This is the belt to its
// braces: even if something requires this file, nothing happens.
// ---------------------------------------------------------------------------
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
