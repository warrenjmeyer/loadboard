const { app } = require('@azure/functions')
const auth = require('../auth')
const store = require('../authStore')
const identity = require('../identity')

// ---------------------------------------------------------------------------
// POST /api/login, POST /api/logout, GET /api/me
//
// The login sequence below is Security.cfc's, step for step, because the two
// apps share accounts and a rule enforced in one place and not the other is
// worse than no rule at all. Where the ordering looks fussy it is load-bearing,
// and the comments say why.
// ---------------------------------------------------------------------------

// Every failed login returns this, whatever went wrong. Distinguishing "no such
// account" from "wrong password" hands anyone a way to discover who has an
// account here, one address at a time.
const GENERIC_FAILURE = 'That email address and password combination is not valid.'

const WINDOW_MINUTES = 15
const FAILURE_LIMIT = 10

async function handleLogin(request, context) {
  const ip = identity.clientIp(request)

  if (!auth.isPepperConfigured()) {
    // Refuse rather than hash without it. A missing pepper would verify
    // nothing and, worse, silently write hashes the ColdFusion app could never
    // read. Better a loud 503 than a quiet divergence.
    context.error('AUTH_PEPPER is not set; refusing to process logins.')
    return { status: 503, jsonBody: { error: 'Sign-in is unavailable. Try again shortly.' } }
  }

  let body
  try {
    body = await request.json()
  } catch {
    return { status: 400, jsonBody: { error: 'Expected a JSON body.' } }
  }

  const email = typeof body?.email === 'string' ? body.email.trim().slice(0, 320) : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!email || !password) {
    return { status: 400, jsonBody: { error: 'Email and password are both required.' } }
  }

  // --- 1. Throttle first, before spending 316ms on a hash ------------------
  //
  // This ordering is the whole defence. The hash is deliberately expensive, so
  // an unthrottled login route is a CPU-exhaustion lever whether or not any
  // guess ever lands.
  const throttle = await store.getThrottleState(email, ip, WINDOW_MINUTES)

  // Per-IP catches credential stuffing: one attempt against each of ten
  // thousand accounts never trips a per-account counter, but lights up per-IP
  // immediately. The multiplier is because an office behind one NAT address
  // shares it.
  if (Number(throttle.FailuresForIp) >= FAILURE_LIMIT * 5) {
    await store.recordLoginAttempt({ email, ip, succeeded: false, failureReason: 'IpThrottled' })
    return { status: 429, jsonBody: { error: GENERIC_FAILURE } }
  }

  // Per-account, checked here rather than trusting the LockoutEndUtc a previous
  // request wrote. Without this, a burst of concurrent attempts on one address
  // all sail past before any has recorded its failure -- and each costs a full
  // verify.
  if (Number(throttle.FailuresForEmail) >= FAILURE_LIMIT) {
    await store.recordLoginAttempt({ email, ip, succeeded: false, failureReason: 'EmailThrottled' })
    return { status: 429, jsonBody: { error: GENERIC_FAILURE } }
  }

  // --- 2. Fetch the facts. The database renders no verdict. ---------------
  const user = await store.getUserForLogin(email)

  // --- 3. Every rejection costs what a success costs ----------------------
  //
  // burnVerify runs a real bcrypt comparison against a throwaway hash. Without
  // it an unknown address returns in a millisecond and a known one in 316, and
  // that gap is a free account-enumeration oracle.
  if (!user || !user.PasswordHash) {
    await auth.burnVerify(password)
    await store.recordLoginAttempt({ email, ip, succeeded: false, failureReason: 'NoSuchUser' })
    return { status: 401, jsonBody: { error: GENERIC_FAILURE } }
  }

  if (user.IsLockedOut) {
    await auth.burnVerify(password)
    await store.recordLoginAttempt({ email, ip, succeeded: false, userId: user.UserId, failureReason: 'LockedOut' })
    return { status: 401, jsonBody: { error: GENERIC_FAILURE } }
  }

  if (!user.IsActive) {
    await auth.burnVerify(password)
    await store.recordLoginAttempt({ email, ip, succeeded: false, userId: user.UserId, failureReason: 'Inactive' })
    return { status: 401, jsonBody: { error: GENERIC_FAILURE } }
  }

  // --- 4. The comparison itself, constant-time inside bcrypt --------------
  if (!(await auth.verifyPassword(password, user.PasswordHash, user.Algorithm))) {
    await store.recordLoginAttempt({ email, ip, succeeded: false, userId: user.UserId, failureReason: 'BadPassword' })
    return { status: 401, jsonBody: { error: GENERIC_FAILURE } }
  }

  // --- 5. Transparent cost upgrade ----------------------------------------
  //
  // Right now, and only right now, we hold the plaintext. If the stored hash
  // is weaker than we currently want, re-hash silently. This is how a cost
  // migration happens without ever asking anyone to reset anything.
  //
  // Other sessions are NOT revoked here: nothing suspicious happened, the
  // person just logged in.
  if (auth.needsRehash(user.PasswordHash)) {
    try {
      await store.setPassword(user.UserId, await auth.hashPassword(password), {
        ip,
        eventType: 'PasswordRehashed',
      })
    } catch (err) {
      // A failed upgrade must not fail the login. They typed the right
      // password; the old hash still works and we will try again next time.
      context.error('rehash after login failed:', err)
    }
  }

  // --- 6. A brand-new session token, always -------------------------------
  //
  // Never carry a pre-login token forward. That is session fixation: an
  // attacker plants a token in someone's browser, waits for them to log in,
  // and then holds a token that is now authenticated.
  const { token, session } = await store.createSession(
    user.UserId,
    ip,
    request.headers.get('user-agent')
  )

  await store.recordLoginAttempt({ email, ip, succeeded: true, userId: user.UserId })

  const authz = await store.getAuthorization(user.UserId)

  return {
    status: 200,
    jsonBody: {
      user: identity.publicUser({
        via: 'session',
        userId: user.UserId,
        sessionId: session.SessionId,
        email: user.Email,
        displayName: user.DisplayName,
        role: authz ? authz.Role : 'none',
        driverCode: authz ? authz.DriverCode : null,
      }),
      emailConfirmed: Boolean(user.EmailConfirmedUtc),
    },
    cookies: [auth.sessionCookie(token)],
  }
}

async function handleLogout(request) {
  const token = auth.readSessionToken(request)

  // Revoke server-side as well as clearing the cookie. Clearing alone would
  // leave a token that still works for anyone who copied it -- "log out" has
  // to mean the session is dead, not merely forgotten by this browser.
  if (token) {
    await store.revokeSession(token, 'Logout', identity.clientIp(request))
  }

  // Always 200. Whether there was a session to end is not the caller's
  // business, and an error here would only ever confuse someone who is
  // already leaving.
  return {
    status: 200,
    jsonBody: { ok: true },
    cookies: [auth.clearSessionCookie()],
  }
}

async function handleMe(request) {
  const user = await identity.currentUser(request)

  // 200 with null rather than 401. "Nobody is signed in" is a normal answer to
  // this question, and the page that asks it needs to render either way.
  return {
    status: 200,
    jsonBody: { user: identity.publicUser(user) },
    headers: {
      // Never cache an identity. A shared cache handing one person's answer to
      // the next visitor is the worst possible bug here.
      'Cache-Control': 'no-store, private',
    },
  }
}

function wrap(name, handler) {
  return async (request, context) => {
    try {
      return await handler(request, context)
    } catch (err) {
      // Log the real error; return a generic one. A SQL message can name the
      // server, the database and the login.
      context.error(`${name} failed:`, err)
      return { status: 500, jsonBody: { error: 'Something went wrong. Try again.' } }
    }
  }
}

app.http('login', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'login',
  handler: wrap('POST /api/login', handleLogin),
})

app.http('logout', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'logout',
  handler: wrap('POST /api/logout', handleLogout),
})

app.http('me', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'me',
  handler: wrap('GET /api/me', handleMe),
})

module.exports = { handleLogin, handleLogout, handleMe }
