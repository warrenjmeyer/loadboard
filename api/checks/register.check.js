// ---------------------------------------------------------------------------
// Drives register / verify / forgot / reset against a real Millstream, with
// the mailer stubbed so nothing is actually sent and no SendGrid key is
// needed. The captured message is inspected instead -- which is stricter than
// sending would be, because it lets us assert what is IN the mail.
//
//   $env:SQL_SERVER / SQL_DATABASE / SQL_USER / SQL_PASSWORD
//   $env:AUTH_PEPPER
//   node api/src/functions/register.check.js
// ---------------------------------------------------------------------------

// Enough for mailer.isConfigured() to pass. sendMail is replaced below, so
// neither value is ever used to reach SendGrid.
process.env.SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || 'SG.stub-not-a-real-key'
process.env.MAIL_FROM = process.env.MAIL_FROM || 'stub@example.invalid'
process.env.PUBLIC_BASE_URL = 'https://loadboard.example.invalid'

const assert = require('node:assert')
const crypto = require('node:crypto')
const { getPool, sql } = require('../src/db')
const auth = require('../src/auth')
const store = require('../src/authStore')
const mailer = require('../src/mailer')
const routes = require('../src/functions/register')
const { handleLogin } = require('../src/functions/session')

const EMAIL = `claude-check-${crypto.randomUUID()}@example.invalid`
const IP = '203.0.113.199'
const PASSWORD = 'a long enough passphrase for the check'
const NEW_PASSWORD = 'a different long passphrase entirely'

let userId = null
let passed = 0
const ok = (label) => { passed++; console.log(`  ok  ${label}`) }

// --- the stub -------------------------------------------------------------
const outbox = []
mailer.sendMail = async (message) => {
  outbox.push(message)
  return { sent: true }
}

function lastMail() {
  assert.ok(outbox.length, 'expected a message to have been sent')
  return outbox[outbox.length - 1]
}

function tokenFrom(mail, param) {
  const m = new RegExp(`[?&]${param}=([^\\s&"<]+)`).exec(mail.text)
  assert.ok(m, `no ${param} token in the mail body`)
  return decodeURIComponent(m[1])
}

function req(body) {
  const headers = { 'x-forwarded-for': IP, 'user-agent': 'register-check/1.0' }
  return {
    method: 'POST',
    headers: { get: (n) => headers[n.toLowerCase()] ?? null },
    json: async () => body,
  }
}

const ctx = { error: (...a) => console.log('    [ctx.error]', ...a), log: () => {} }

async function main() {
  assert.ok(auth.isPepperConfigured(), 'AUTH_PEPPER must be set')
  console.log(`test row ${EMAIL}\n`)
  await getPool()

  // --- password policy ----------------------------------------------------
  assert.match(await routes.checkPassword('password'), /too easily guessed/)
  ok('the blocklist is checked before the length rule')

  assert.match(await routes.checkPassword('short'), /at least 12/)
  assert.match(await routes.checkPassword('x'.repeat(129)), /128 characters or fewer/)
  ok('length bounds match Security.cfc: 12 to 128')

  // A long password that is nonetheless in the breach corpus.
  const breached = await routes.checkPassword('trustno1trustno1')
  if (breached) {
    assert.match(breached, /data breaches/)
    ok('a breached password is refused by the HIBP check')
  } else {
    ok('HIBP unreachable or that password is unbreached; check skipped')
  }

  assert.strictEqual(await routes.checkPassword(PASSWORD), null)
  ok('a good passphrase passes with no composition rules')

  // --- register -----------------------------------------------------------
  let r = await routes.handleRegister(req({ email: EMAIL, password: PASSWORD, displayName: 'Register Check' }), ctx)
  assert.strictEqual(r.status, 202)
  const genericMessage = r.jsonBody.message
  ok('register -> 202')

  const created = await store.getUserForLogin(EMAIL)
  assert.ok(created, 'the account should exist')
  userId = created.UserId
  assert.strictEqual(created.EmailConfirmedUtc, null, 'not confirmed until the link is opened')
  ok(`the account exists as UserId ${userId}, unconfirmed`)

  const authz = await store.getAuthorization(userId)
  assert.strictEqual(authz.Role, 'none')
  ok('the new account is powerless until approved')

  // The mail must carry a link and must NOT carry a password.
  const verifyMail = lastMail()
  assert.match(verifyMail.subject, /Confirm/i)
  assert.ok(!/password:/i.test(verifyMail.text), 'no password may appear in the mail')
  const verifyToken = tokenFrom(verifyMail, 'verify')
  ok('the verification mail carries a link and no password')

  // --- registering the same address again ---------------------------------
  const before = outbox.length
  r = await routes.handleRegister(req({ email: EMAIL.toUpperCase(), password: 'yet another long passphrase' }), ctx)
  assert.strictEqual(r.status, 202)
  assert.strictEqual(r.jsonBody.message, genericMessage, 'the response must not reveal that the address is taken')
  assert.strictEqual(outbox.length, before + 1, 'the owner is told, even though the form is not')
  assert.match(lastMail().subject, /already have/i)
  ok('a duplicate signup tells the owner, not the form')

  const stillOne = await getPool().then((p) =>
    p.request().input('e', sql.NVarChar(320), EMAIL.toLowerCase())
      .query('SELECT COUNT(*) AS n FROM auth.Users WHERE EmailNormalized = @e'))
  assert.strictEqual(stillOne.recordset[0].n, 1, 'no second account')
  ok('no duplicate account was created')

  // The original password must still work -- a second signup attempt must not
  // have changed anything about the existing account.
  const check = await store.getUserForLogin(EMAIL)
  assert.strictEqual(await auth.verifyPassword(PASSWORD, check.PasswordHash, check.Algorithm), true)
  ok('the existing account and its password are untouched')

  // --- verify -------------------------------------------------------------
  r = await routes.handleVerify(req({ token: verifyToken }), ctx)
  assert.strictEqual(r.status, 200)
  assert.match(r.jsonBody.message, /approve/i, 'confirming an address is not approval')
  assert.ok((await store.getUserForLogin(EMAIL)).EmailConfirmedUtc)
  ok('verify confirms the address and says approval is still pending')

  r = await routes.handleVerify(req({ token: verifyToken }), ctx)
  assert.strictEqual(r.status, 400)
  ok('the verification link cannot be used twice')

  // --- forgot: THE FIX ----------------------------------------------------
  r = await routes.handleForgot(req({ email: EMAIL }), ctx)
  assert.strictEqual(r.status, 202)
  const resetToken = tokenFrom(lastMail(), 'reset')
  ok('forgot -> 202 with a reset link')

  // The 2023 hole, closed. Asking for a reset must do NOTHING to the account
  // until somebody opens the link.
  const afterForgot = await store.getUserForLogin(EMAIL)
  assert.strictEqual(afterForgot.PasswordHash, check.PasswordHash, 'the stored hash must be unchanged')
  assert.strictEqual(await auth.verifyPassword(PASSWORD, afterForgot.PasswordHash, afterForgot.Algorithm), true)
  ok('asking for a reset does NOT change the password (the 2023 hole)')

  // And an unknown address is answered identically.
  r = await routes.handleForgot(req({ email: `nobody-${crypto.randomUUID()}@example.invalid` }), ctx)
  assert.strictEqual(r.status, 202)
  assert.strictEqual(r.jsonBody.message, genericMessage)
  ok('an unknown address gets the identical answer')

  // --- reset --------------------------------------------------------------
  // A weak password must be refused WITHOUT spending the token, or the person
  // has to request a new link for every failed attempt.
  r = await routes.handleReset(req({ token: resetToken, password: 'short' }), ctx)
  assert.strictEqual(r.status, 400)
  ok('a rejected password does not burn the link')

  r = await routes.handleReset(req({ token: resetToken, password: NEW_PASSWORD }), ctx)
  assert.strictEqual(r.status, 200)
  ok('reset -> 200 with the same token still valid after the rejection')

  const afterReset = await store.getUserForLogin(EMAIL)
  assert.strictEqual(await auth.verifyPassword(NEW_PASSWORD, afterReset.PasswordHash, afterReset.Algorithm), true)
  assert.strictEqual(await auth.verifyPassword(PASSWORD, afterReset.PasswordHash, afterReset.Algorithm), false)
  ok('the new password works and the old one does not')

  r = await routes.handleReset(req({ token: resetToken, password: 'another valid passphrase here' }), ctx)
  assert.strictEqual(r.status, 400)
  ok('the reset link cannot be used twice')

  // --- and the whole thing works end to end -------------------------------
  const login = await handleLogin(req({ email: EMAIL, password: NEW_PASSWORD }), ctx)
  assert.strictEqual(login.status, 200)
  assert.strictEqual(login.jsonBody.user.pendingApproval, true)
  assert.strictEqual(login.jsonBody.emailConfirmed, true)
  ok('register -> verify -> forgot -> reset -> login, end to end')
}

async function cleanup() {
  if (!userId) return
  const pool = await getPool()
  await pool.request().input('u', sql.Int, userId).input('ip', sql.VarChar(45), IP).query(`
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
