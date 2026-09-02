// ---------------------------------------------------------------------------
// The account-approval routes, against a real Millstream.
//
//   node api/checks/admin.check.js
//
// The interesting assertions are the refusals. Approving someone is easy to
// get right; the ways an admin can lock themselves out of their own app are
// not, and recovering from that needs a DBA and a SQL prompt.
// ---------------------------------------------------------------------------
const assert = require('node:assert')
const crypto = require('node:crypto')
const { app } = require('@azure/functions')

const handlers = {}

function captureHandlers() {
  const realHttp = app.http.bind(app)
  app.http = (name, opts) => { handlers[name] = opts.handler }
  try {
    require('../src/functions/admin')
  } finally {
    app.http = realHttp
  }
}

const { getPool, sql } = require('../src/db')
const auth = require('../src/auth')
const store = require('../src/authStore')

const IP = '203.0.113.199'
const SUFFIX = crypto.randomUUID()
const people = {}
let passed = 0
const ok = (label) => { passed++; console.log(`  ok  ${label}`) }
const ctx = { error: (...a) => console.log('    [ctx.error]', ...a), log: () => {} }

function req({ cookie = null, body = null, params = {}, method = 'GET' } = {}) {
  const headers = { 'x-forwarded-for': IP, 'user-agent': 'admin-check/1.0', ...(cookie ? { cookie } : {}) }
  return {
    method,
    params,
    headers: { get: (n) => headers[n.toLowerCase()] ?? null },
    json: async () => { if (body === null) throw new Error('no body'); return body },
  }
}

async function makePerson(key, role, driverCode) {
  const email = `claude-admin-${key}-${SUFFIX}@example.invalid`
  const created = await store.createUser(email, await auth.hashPassword('a passphrase for the admin check'), `admin check ${key}`, IP)

  if (role !== 'none') {
    const pool = await getPool()
    await pool.request()
      .input('u', sql.Int, created.UserId).input('r', sql.VarChar(20), role)
      .input('d', sql.VarChar(20), driverCode || null)
      .query('UPDATE auth.Users SET [Role]=@r, DriverCode=@d, ModifiedUtc=SYSUTCDATETIME() WHERE UserId=@u;')
  }

  const { token } = await store.createSession(created.UserId, IP, 'admin-check/1.0')
  const full = await store.findUserByPublicId(
    (await pool0()).recordset.find((x) => x.UserId === created.UserId)?.PublicId
  )
  people[key] = { userId: created.UserId, email, cookie: `lb_session=${token}`, publicId: full.PublicId }
  return people[key]
}

async function pool0() {
  const pool = await getPool()
  return pool.request().query('SELECT UserId, PublicId FROM auth.Users;')
}

async function main() {
  assert.ok(auth.isPepperConfigured(), 'AUTH_PEPPER must be set')
  captureHandlers()
  await getPool()

  const pool = await getPool()
  const drivers = await pool.request().query('SELECT TOP 1 driver_code FROM dbo.Drivers ORDER BY driver_code;')
  const CODE = drivers.recordset[0].driver_code

  await makePerson('admin', 'admin')
  await makePerson('admin2', 'admin')
  await makePerson('pending', 'none')
  await makePerson('dispatcher', 'dispatcher')
  ok('created two admins, a pending account and a dispatcher')

  // --- who may open it at all ---------------------------------------------
  let r = await handlers.adminUsers(req(), ctx)
  assert.strictEqual(r.status, 401)
  ok('anonymous cannot list accounts -> 401')

  r = await handlers.adminUsers(req({ cookie: people.pending.cookie }), ctx)
  assert.strictEqual(r.status, 403)
  ok('a pending account cannot list accounts -> 403')

  r = await handlers.adminUsers(req({ cookie: people.dispatcher.cookie }), ctx)
  assert.strictEqual(r.status, 403)
  ok('a DISPATCHER cannot list accounts -> 403 (approving is admin-only)')

  r = await handlers.adminUsers(req({ cookie: people.admin.cookie }), ctx)
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.ok(Array.isArray(r.jsonBody.users) && r.jsonBody.users.length >= 4)
  assert.ok(Array.isArray(r.jsonBody.drivers) && r.jsonBody.drivers.length > 0)
  ok(`admin lists ${r.jsonBody.users.length} accounts and ${r.jsonBody.drivers.length} drivers`)

  // Nothing internal leaks.
  const sample = r.jsonBody.users[0]
  assert.strictEqual(sample.userId, undefined, 'UserId must never reach the browser')
  assert.ok(sample.publicId, 'rows are addressed by PublicId')
  ok('rows carry PublicId and no sequential UserId')

  // Pending first: the only row anyone opens this page to act on.
  assert.strictEqual(
    r.jsonBody.users.findIndex((u) => u.publicId === people.pending.publicId) <
      r.jsonBody.users.findIndex((u) => u.publicId === people.dispatcher.publicId),
    true,
    'accounts waiting for approval must sort first'
  )
  ok('accounts waiting for approval sort to the top')

  // --- approving ----------------------------------------------------------
  const post = (actor, publicId, body) =>
    handlers.adminUserUpdate(req({ method: 'POST', cookie: actor.cookie, params: { publicId }, body }), ctx)

  r = await post(people.admin, people.pending.publicId, { role: 'dispatcher' })
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.strictEqual(r.jsonBody.role, 'dispatcher')
  ok('an admin can approve a pending account as dispatcher')

  // And it takes effect on the next request, not the next sign-in.
  const authz = await store.getAuthorization(people.pending.userId)
  assert.strictEqual(authz.Role, 'dispatcher')
  ok('the change is live immediately -- no re-login needed')

  // --- driver code rules --------------------------------------------------
  r = await post(people.admin, people.pending.publicId, { role: 'driver' })
  assert.strictEqual(r.status, 400)
  assert.match(r.jsonBody.error, /driver code/i)
  ok('promoting to driver without a code -> 400, not a constraint violation')

  r = await post(people.admin, people.pending.publicId, { role: 'driver', driverCode: 'NOSUCH' })
  assert.strictEqual(r.status, 400)
  assert.match(r.jsonBody.error, /no driver with code/i)
  ok('an unknown driver code -> 400, not a foreign-key 500')

  r = await post(people.admin, people.pending.publicId, { role: 'driver', driverCode: CODE.toLowerCase() })
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.strictEqual(r.jsonBody.driverCode, CODE)
  ok(`a driver code is accepted case-insensitively (${CODE})`)

  // Moving off driver must clear the code, or CK_Users_DriverCode rejects it.
  r = await post(people.admin, people.pending.publicId, { role: 'dispatcher' })
  assert.strictEqual(r.jsonBody.driverCode, null)
  ok('leaving the driver role clears the driver code')

  r = await post(people.admin, people.pending.publicId, { role: 'wizard' })
  assert.strictEqual(r.status, 400)
  ok('an unknown role -> 400')

  // --- the guards that stop you locking yourself out ----------------------
  r = await post(people.admin, people.admin.publicId, { role: 'none' })
  assert.strictEqual(r.status, 409)
  assert.match(r.jsonBody.error, /your own role/i)
  ok('an admin CANNOT demote themselves -> 409')

  r = await post(people.admin, people.admin.publicId, { isActive: false })
  assert.strictEqual(r.status, 409)
  assert.match(r.jsonBody.error, /own account/i)
  ok('an admin CANNOT deactivate themselves -> 409')

  // With two admins, demoting the other one is allowed.
  r = await post(people.admin, people.admin2.publicId, { role: 'dispatcher' })
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  ok('with two admins, one may demote the other')

  // Demoted, so no longer allowed to manage accounts at all.
  r = await post(people.admin2, people.admin.publicId, { role: 'none' })
  assert.strictEqual(r.status, 403)
  ok('a just-demoted admin immediately loses access to this page -> 403')

  // The count the last-admin guard depends on must be right, whatever it is.
  const admins = await store.countActiveAdmins()
  const counted = await pool.request().query(
    `SELECT COUNT(*) AS n FROM auth.Users WHERE [Role]='admin' AND IsActive=1;`)
  assert.strictEqual(admins, counted.recordset[0].n)
  assert.ok(admins >= 1, 'there must always be at least one admin')
  ok(`countActiveAdmins agrees with the table (${admins})`)

  // HONEST GAP: the last-admin refusal itself is NOT exercised here, and
  // cannot be without demoting Warren's real account to drive the count to
  // one. So the branch that refuses "you are the last administrator" has been
  // read and never run. It is the one guard in this file taken on trust, and
  // it is worth knowing that rather than reading a green line that implies
  // otherwise.
  console.log('  --  last-admin refusal NOT exercised (would need the real admin demoted)')

  // --- deactivating -------------------------------------------------------
  r = await post(people.admin, people.pending.publicId, { isActive: false })
  assert.strictEqual(r.status, undefined, JSON.stringify(r.jsonBody))
  assert.strictEqual(r.jsonBody.isActive, false)
  ok('an admin can disable an account')

  // Disabling ends its sessions at once -- that is the whole point.
  assert.strictEqual(await store.validateSession(people.pending.cookie.split('=')[1]), null)
  ok('disabling an account kills its live sessions immediately')

  r = await post(people.admin, people.pending.publicId, { isActive: true })
  assert.strictEqual(r.jsonBody.isActive, true)
  ok('and can enable it again')

  // --- bad input ----------------------------------------------------------
  r = await post(people.admin, 'not-a-guid', { role: 'none' })
  assert.strictEqual(r.status, 400)
  r = await post(people.admin, crypto.randomUUID(), { role: 'none' })
  assert.strictEqual(r.status, 404)
  r = await post(people.admin, people.pending.publicId, { nonsense: true })
  assert.strictEqual(r.status, 400)
  ok('a malformed id is 400, an unknown one 404, an empty change 400')

  // --- the audit trail records who did it ---------------------------------
  const events = await pool.request().input('u', sql.Int, people.pending.userId).query(
    `SELECT TOP 1 Detail FROM auth.AuthEvents
      WHERE UserId=@u AND EventType='RoleChanged' ORDER BY AuthEventId DESC;`)
  assert.ok(events.recordset.length, 'a role change must be recorded')
  assert.ok(events.recordset[0].Detail.includes(people.admin.email), 'the record must name who did it')
  ok('a role change is recorded, naming the admin who made it')
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
      DELETE FROM auth.Users          WHERE UserId = @u;`)
  }
  const left = await pool.request().query("SELECT COUNT(*) AS n FROM auth.Users WHERE Email LIKE 'claude-admin-%';")
  console.log(`\ncleanup  test users left: ${left.recordset[0].n}`)
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
