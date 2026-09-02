// ---------------------------------------------------------------------------
// Drives POST /api/login, POST /api/logout and GET /api/me against a real
// Millstream, by calling the handlers directly with mock request objects.
//
// No HTTP, no Functions host -- which is the point. Azure Functions Core Tools
// is not installed on this machine, and the interesting logic is not in the
// transport anyway: it is the ordering of the throttle check, the burn, the
// verify and the session issue. That is all reachable from here.
//
//   $env:SQL_SERVER / SQL_DATABASE / SQL_USER / SQL_PASSWORD
//   $env:AUTH_PEPPER
//   node api/src/functions/session.check.js
// ---------------------------------------------------------------------------
const assert = require('node:assert')
const crypto = require('node:crypto')
const { getPool, sql } = require('../src/db')
const auth = require('../src/auth')
const store = require('../src/authStore')
const { handleLogin, handleLogout, handleMe } = require('../src/functions/session')

const EMAIL = `claude-check-${crypto.randomUUID()}@example.invalid`
const IP = '203.0.113.199'
const PASSWORD = 'a passphrase for the session check'

let userId = null
let passed = 0

const ok = (label) => { passed++; console.log(`  ok  ${label}`) }

// Enough of an Azure Functions request for these handlers.
function req({ body = null, cookie = null, ua = 'session-check/1.0', principal = null } = {}) {
  const headers = {
    'x-forwarded-for': IP,
    'user-agent': ua,
    ...(cookie ? { cookie } : {}),
    ...(principal ? { 'x-ms-client-principal': Buffer.from(JSON.stringify(principal)).toString('base64') } : {}),
  }
  return {
    method: body ? 'POST' : 'GET',
    headers: { get: (n) => headers[n.toLowerCase()] ?? null },
    json: async () => {
      if (body === null) throw new Error('no body')
      return body
    },
  }
}

// Console-shaped context, so a handler logging an error does not crash the run.
const ctx = { error: (...a) => console.log('    [ctx.error]', ...a), log: () => {} }

// Pull the session token back out of a Set-Cookie string.
function cookieToken(result) {
  assert.ok(Array.isArray(result.cookies) && result.cookies.length, 'expected a cookie')
  const m = /lb_session=([^;]*)/.exec(result.cookies[0])
  return m ? m[1] : null
}

async function main() {
  assert.ok(auth.isPepperConfigured(), 'AUTH_PEPPER must be set')
  console.log(`test row ${EMAIL}\n`)
  await getPool()

  const created = await store.createUser(EMAIL, await auth.hashPassword(PASSWORD), 'Session Check', IP)
  userId = created.UserId
  ok(`created UserId ${userId}`)

  // --- anonymous ----------------------------------------------------------
  let r = await handleMe(req(), ctx)
  assert.strictEqual(r.status, 200)
  assert.strictEqual(r.jsonBody.user, null, 'nobody signed in is a normal answer, not a 401')
  assert.match(r.headers['Cache-Control'], /no-store/)
  ok('GET /api/me anonymous -> 200 with null, uncacheable')

  // --- bad input ----------------------------------------------------------
  r = await handleLogin(req({ body: { email: EMAIL } }), ctx)
  assert.strictEqual(r.status, 400)
  ok('login without a password -> 400')

  // --- wrong password -----------------------------------------------------
  const tWrong = Date.now()
  r = await handleLogin(req({ body: { email: EMAIL, password: 'not the password' } }), ctx)
  const msWrong = Date.now() - tWrong
  assert.strictEqual(r.status, 401)
  assert.ok(!r.cookies, 'a failed login must not set a session cookie')
  const genericMessage = r.jsonBody.error
  ok(`wrong password -> 401 in ${msWrong}ms, no cookie`)

  // --- unknown address ----------------------------------------------------
  const tUnknown = Date.now()
  r = await handleLogin(req({ body: { email: `nobody-${crypto.randomUUID()}@example.invalid`, password: 'whatever' } }), ctx)
  const msUnknown = Date.now() - tUnknown
  assert.strictEqual(r.status, 401)
  assert.strictEqual(r.jsonBody.error, genericMessage, 'the message must not distinguish the two')
  ok('unknown address -> 401 with the identical message')

  // The enumeration oracle this closes: without burnVerify the unknown case
  // returns in about a millisecond and the known one in ~316.
  const ratio = msUnknown / Math.max(msWrong, 1)
  assert.ok(ratio > 0.5 && ratio < 2.0, `timing differs too much: known ${msWrong}ms vs unknown ${msUnknown}ms`)
  ok(`timings comparable: known ${msWrong}ms vs unknown ${msUnknown}ms`)

  // --- the real thing -----------------------------------------------------
  r = await handleLogin(req({ body: { email: EMAIL, password: PASSWORD } }), ctx)
  assert.strictEqual(r.status, 200)
  assert.strictEqual(r.jsonBody.user.email, EMAIL)
  assert.strictEqual(r.jsonBody.user.role, 'none')
  assert.strictEqual(r.jsonBody.user.pendingApproval, true, 'a new account is powerless until approved')
  assert.strictEqual(r.jsonBody.emailConfirmed, false)
  ok('correct password -> 200, role=none, pendingApproval')

  const cookie = r.cookies[0]
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax']) {
    assert.ok(cookie.includes(flag), `cookie missing ${flag}`)
  }
  ok('the session cookie carries HttpOnly, Secure and SameSite')

  const token = cookieToken(r)

  // Case-insensitive email, since EmailNormalized is lower-cased.
  const upper = await handleLogin(req({ body: { email: EMAIL.toUpperCase(), password: PASSWORD } }), ctx)
  assert.strictEqual(upper.status, 200)
  ok('the address is matched case-insensitively')

  // Session fixation: a second login must not reuse the first token.
  assert.notStrictEqual(cookieToken(upper), token, 'every login issues a fresh token')
  ok('each login issues a brand-new token')

  // --- me, with a session -------------------------------------------------
  r = await handleMe(req({ cookie: `lb_session=${token}` }), ctx)
  assert.strictEqual(r.jsonBody.user.email, EMAIL)
  assert.strictEqual(r.jsonBody.user.via, 'session')
  ok('GET /api/me with the cookie -> the signed-in user')

  // Nothing internal leaks to the browser.
  assert.strictEqual(r.jsonBody.user.userId, undefined)
  assert.strictEqual(r.jsonBody.user.sessionId, undefined)
  ok('no internal identifiers in the response body')

  // --- logout -------------------------------------------------------------
  r = await handleLogout(req({ cookie: `lb_session=${token}` }), ctx)
  assert.strictEqual(r.status, 200)
  assert.ok(r.cookies[0].includes('Max-Age=0'), 'the cookie must be expired')
  ok('POST /api/logout -> 200 and an expired cookie')

  // Revoked server-side, not merely forgotten by the browser.
  r = await handleMe(req({ cookie: `lb_session=${token}` }), ctx)
  assert.strictEqual(r.jsonBody.user, null, 'the token must be dead even if the browser kept it')
  ok('the old token is dead server-side, not just cleared')

  r = await handleLogout(req(), ctx)
  assert.strictEqual(r.status, 200)
  ok('logout with no session is still 200')

  // --- throttling (last: it poisons this address and IP) ------------------
  let throttled = null
  for (let i = 0; i < 12; i++) {
    const attempt = await handleLogin(req({ body: { email: EMAIL, password: `wrong-${i}` } }), ctx)
    if (attempt.status === 429) { throttled = i; break }
  }
  assert.notStrictEqual(throttled, null, 'repeated failures must eventually throttle')
  ok(`throttled after ${throttled} failed attempts -> 429`)

  // And the throttle holds even against the RIGHT password, or it would be a
  // free oracle for confirming a guess.
  r = await handleLogin(req({ body: { email: EMAIL, password: PASSWORD } }), ctx)
  assert.strictEqual(r.status, 429)
  assert.ok(!r.cookies)
  ok('the throttle refuses even a correct password')
}

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
  const left = await pool.request().input('u', sql.Int, userId)
    .query('SELECT COUNT(*) AS n FROM auth.Users WHERE UserId = @u')
  console.log(`\ncleanup  removed test user ${userId} (rows remaining: ${left.recordset[0].n})`)
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
