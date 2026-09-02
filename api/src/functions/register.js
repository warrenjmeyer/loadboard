const { app } = require('@azure/functions')
const auth = require('../auth')
const store = require('../authStore')
const identity = require('../identity')
const mailer = require('../mailer')
const { isPasswordBreached } = require('../pwned')

// ---------------------------------------------------------------------------
// POST /api/register, /api/verify, /api/forgot, /api/reset
//
// The flow Warren described, with the dangerous half removed. He asked for an
// email containing "a link and a temporary password". There is no temporary
// password here and there never will be: the 2023 ColdFusion original mailed
// one derived from the request clock AND overwrote the real password with it,
// so submitting a stranger's address locked them out and handed the sender an
// account.
//
// The link IS the credential. It is 32 random bytes, stored only as a SHA-256,
// single-use, and expires in an hour. Nothing on the account changes until
// somebody opens it -- which is the structural fix, not a patch.
// ---------------------------------------------------------------------------

// Matches checkPasswordPolicy() in Security.cfc. Same numbers, same blocklist,
// same order -- a password accepted by one app must be accepted by the other,
// or someone sets a password in ColdFusion that this app would have refused.
const MIN_PASSWORD = 12
const MAX_PASSWORD = 128

// Checked BEFORE the length rule, and that ordering is deliberate: every entry
// shorter than twelve characters would otherwise be unreachable, and the
// most-guessed passwords in the world are exactly the short ones. "password"
// is eight characters and must produce the specific "too easily guessed"
// message rather than a generic complaint about length.
const OBVIOUS = new Set(
  ('password,passw0rd,password1,123456,12345678,123456789,qwerty,qwertyuiop,' +
   'letmein,welcome,admin,administrator,iloveyou,changeme,monkey,dragon,' +
   'football,princess,123456789012,letmein12345,welcome12345,changeme1234'
  ).split(',')
)

// One answer for every registration and every reset request, whatever
// happened. Saying "that address is already taken" or "no such account" turns
// the form into an account-enumeration oracle: anyone can discover who has an
// account here, one address at a time.
const GENERIC_ACCEPTED = 'Check your email. If that address can be used, a link is on its way.'

async function checkPassword(password) {
  if (typeof password !== 'string') return 'A password is required.'

  if (OBVIOUS.has(password.trim().toLowerCase())) {
    return 'That password is too easily guessed.'
  }
  if (password.length < MIN_PASSWORD) {
    return `Password must be at least ${MIN_PASSWORD} characters.`
  }
  if (password.length > MAX_PASSWORD) {
    return `Password must be ${MAX_PASSWORD} characters or fewer.`
  }

  // Our addition, and the highest-value rule here. No composition rules -- no
  // "must contain a symbol", which reliably produces Password1! -- because
  // current NIST guidance drops them and screens against real breach data
  // instead. This is the actual list attackers try.
  //
  // Fails open: if the service is unreachable the password is allowed. Their
  // outage must not become ours.
  const { breached, count } = await isPasswordBreached(password)
  if (breached) {
    return `That password has appeared in ${count.toLocaleString()} known data breaches. Choose another.`
  }

  return null
}

async function readJson(request) {
  try {
    return await request.json()
  } catch {
    return null
  }
}

function preflight(context) {
  if (!auth.isPepperConfigured()) {
    context.error('AUTH_PEPPER is not set; refusing to write password hashes.')
    return { status: 503, jsonBody: { error: 'Accounts are unavailable right now. Try again shortly.' } }
  }
  if (!mailer.isConfigured()) {
    context.error('SENDGRID_API_KEY or MAIL_FROM is not set; cannot send the link.')
    return { status: 503, jsonBody: { error: 'Email is not configured yet. Try again shortly.' } }
  }
  return null
}

// ---------------------------------------------------------------------------
// POST /api/register
// ---------------------------------------------------------------------------
async function handleRegister(request, context) {
  const blocked = preflight(context)
  if (blocked) return blocked

  const ip = identity.clientIp(request)
  const body = await readJson(request)
  if (!body) return { status: 400, jsonBody: { error: 'Expected a JSON body.' } }

  const email = auth.normaliseEmail(body.email)
  if (!email) return { status: 400, jsonBody: { error: 'That does not look like an email address.' } }

  // The password is checked before anything is written, and its complaints are
  // specific -- unlike the outcome, which never is. Telling someone their
  // password is too short reveals nothing about who else has an account.
  const complaint = await checkPassword(body.password)
  if (complaint) return { status: 400, jsonBody: { error: complaint } }

  // Rate limit before touching the account. Registration sends mail to an
  // address the caller chose, so an unthrottled route is a way to have this
  // app deliver unwanted email to strangers on someone else's behalf.
  const limit = await store.hitRateLimit('register', email, ip, {
    windowMinutes: 60,
    subjectLimit: 3,
    ipLimit: 15,
  })
  if (limit && limit.Allowed === false) {
    // The same message as success. A distinct "slow down" would confirm that
    // this address is worth hammering.
    return { status: 202, jsonBody: { message: GENERIC_ACCEPTED } }
  }

  const base = mailer.baseUrlFor(request)
  const existing = await store.getUserForLogin(email)

  if (existing) {
    // Do NOT create a second account, and do NOT tell the form. The person who
    // owns the address is told instead -- which is the only party entitled to
    // know, and who would want to know if it was not them.
    const mail = mailer.alreadyRegisteredMail(`${base}/?signin=1`)
    const result = await mailer.sendMail({ to: email, ...mail })
    if (!result.sent) context.error('already-registered mail failed:', result.reason, result.detail || '')

    await store.recordLoginAttempt({ email, ip, succeeded: false, userId: existing.UserId, failureReason: 'DuplicateSignup' })
    return { status: 202, jsonBody: { message: GENERIC_ACCEPTED } }
  }

  // usp_User_Create writes the user, the password and the audit row in one
  // transaction, so there is never an account without a password. Role
  // defaults to 'none': registration is open and a new account can do nothing
  // until an admin approves it.
  const created = await store.createUser(
    email,
    await auth.hashPassword(body.password),
    typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 100) : null,
    ip
  )

  const token = await store.issueToken(created.UserId, store.PURPOSE.VERIFY, ip)
  const mail = mailer.verificationMail(
    `${base}/?verify=${encodeURIComponent(token)}`,
    store.TOKEN_TTL_MINUTES
  )
  const result = await mailer.sendMail({ to: email, ...mail })

  if (!result.sent) {
    // The account exists but the link did not go out. Say so plainly rather
    // than claiming success -- there is no enumeration risk here, because we
    // already know this address had no account a moment ago.
    context.error('verification mail failed:', result.reason, result.detail || '')
    return {
      status: 502,
      jsonBody: { error: 'Your account was created but the email could not be sent. Use "forgot password" to get a link.' },
    }
  }

  return { status: 202, jsonBody: { message: GENERIC_ACCEPTED } }
}

// ---------------------------------------------------------------------------
// POST /api/verify -- opening the link from the registration email
// ---------------------------------------------------------------------------
async function handleVerify(request, context) {
  const ip = identity.clientIp(request)
  const body = await readJson(request)
  const token = body && typeof body.token === 'string' ? body.token : ''

  if (!token) return { status: 400, jsonBody: { error: 'That link is missing its token.' } }

  const redeemed = await store.redeemToken(store.PURPOSE.VERIFY, token)
  if (!redeemed) {
    // One message for expired, already-used, wrong-purpose and never-existed.
    // The person needs the same next step in every case.
    return { status: 400, jsonBody: { error: 'That link has expired or has already been used. Ask for a new one.' } }
  }

  await store.confirmEmail(redeemed.UserId, ip)

  return {
    status: 200,
    jsonBody: {
      email: redeemed.Email,
      // Confirming the address does not grant access to anything. Said here so
      // the page can explain the wait rather than looking broken.
      message: 'Your email is confirmed. An administrator still needs to approve your account before you can use it.',
    },
  }
}

// ---------------------------------------------------------------------------
// POST /api/forgot -- ask for a reset link
// ---------------------------------------------------------------------------
async function handleForgot(request, context) {
  const blocked = preflight(context)
  if (blocked) return blocked

  const ip = identity.clientIp(request)
  const body = await readJson(request)
  const email = auth.normaliseEmail(body && body.email)

  // Even a malformed address gets the generic answer. A 400 here would say
  // "that address is not one of ours" just as loudly as a 404.
  if (!email) return { status: 202, jsonBody: { message: GENERIC_ACCEPTED } }

  const limit = await store.hitRateLimit('reset', email, ip, {
    windowMinutes: 60,
    subjectLimit: 3,
    ipLimit: 15,
  })
  if (limit && limit.Allowed === false) {
    return { status: 202, jsonBody: { message: GENERIC_ACCEPTED } }
  }

  const user = await store.getUserForLogin(email)

  // THE ACCOUNT IS NOT TOUCHED. No password is changed, no flag is set,
  // nothing is invalidated. Asking for a reset on someone else's address must
  // do nothing whatsoever to them -- that is the entire fix for the 2023
  // version, which overwrote the password before anyone proved they owned the
  // mailbox.
  if (user && user.IsActive) {
    const token = await store.issueToken(user.UserId, store.PURPOSE.RESET, ip)
    const mail = mailer.resetMail(
      `${mailer.baseUrlFor(request)}/?reset=${encodeURIComponent(token)}`,
      store.TOKEN_TTL_MINUTES
    )
    const result = await mailer.sendMail({ to: email, ...mail })
    if (!result.sent) context.error('reset mail failed:', result.reason, result.detail || '')
  }

  return { status: 202, jsonBody: { message: GENERIC_ACCEPTED } }
}

// ---------------------------------------------------------------------------
// POST /api/reset -- set a new password using the emailed link
// ---------------------------------------------------------------------------
async function handleReset(request, context) {
  const blocked = preflight(context)
  if (blocked) return blocked

  const ip = identity.clientIp(request)
  const body = await readJson(request)
  if (!body) return { status: 400, jsonBody: { error: 'Expected a JSON body.' } }

  const token = typeof body.token === 'string' ? body.token : ''
  if (!token) return { status: 400, jsonBody: { error: 'That link is missing its token.' } }

  // Check the password BEFORE spending the token. Otherwise a rejected
  // password burns the link and the person has to request another one to try
  // a different password -- three times, and the rate limit locks them out of
  // their own account recovery.
  const complaint = await checkPassword(body.password)
  if (complaint) return { status: 400, jsonBody: { error: complaint } }

  const redeemed = await store.redeemToken(store.PURPOSE.RESET, token)
  if (!redeemed) {
    return { status: 400, jsonBody: { error: 'That link has expired or has already been used. Ask for a new one.' } }
  }

  // Revokes every existing session, which is the point: if the password was
  // reset because it leaked, leaving the attacker's session alive makes the
  // reset pointless. keepSessionId is null -- nobody survives a reset arriving
  // from an emailed link, including whoever is holding this browser.
  await store.setPassword(redeemed.UserId, await auth.hashPassword(body.password), {
    keepSessionId: null,
    ip,
    eventType: 'PasswordReset',
  })

  // A reset from a link proves the address as surely as the verification mail
  // does, so an account that never confirmed is confirmed now.
  await store.confirmEmail(redeemed.UserId, ip)

  return {
    status: 200,
    jsonBody: {
      email: redeemed.Email,
      message: 'Your password has been changed. You have been signed out everywhere; sign in with the new password.',
    },
  }
}

function wrap(name, handler) {
  return async (request, context) => {
    try {
      return await handler(request, context)
    } catch (err) {
      context.error(`${name} failed:`, err)
      return { status: 500, jsonBody: { error: 'Something went wrong. Try again.' } }
    }
  }
}

app.http('register', { methods: ['POST'], authLevel: 'anonymous', route: 'register', handler: wrap('POST /api/register', handleRegister) })
app.http('verify', { methods: ['POST'], authLevel: 'anonymous', route: 'verify', handler: wrap('POST /api/verify', handleVerify) })
app.http('forgot', { methods: ['POST'], authLevel: 'anonymous', route: 'forgot', handler: wrap('POST /api/forgot', handleForgot) })
app.http('reset', { methods: ['POST'], authLevel: 'anonymous', route: 'reset', handler: wrap('POST /api/reset', handleReset) })

module.exports = {
  handleRegister,
  handleVerify,
  handleForgot,
  handleReset,
  checkPassword,
  MIN_PASSWORD,
  MAX_PASSWORD,
}
