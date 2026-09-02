const crypto = require('node:crypto')
const bcrypt = require('bcryptjs')

// ---------------------------------------------------------------------------
// The cryptographic core of the login.
//
// Every choice in this file is dictated by C:\Websites\app-scaffold, the
// ColdFusion app that already owns the auth schema in Millstream. That app and
// this one share one set of accounts, so they must agree on the password
// recipe byte for byte -- a password set here has to verify there, and the
// other way round. Where this file looks like it is following someone else's
// decisions, it is, and deliberately: see services/Security.cfc.
//
// The one thing NOT shared is the session cookie. Cookies do not cross
// origins, so ColdFusion on localhost:8500 and this app on
// azurestaticapps.net are always separate sign-ins against the same accounts.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The pepper.
//
// A secret that lives outside the database -- in the Function App's settings
// here, in config/env.json for ColdFusion. A stolen database backup is
// useless without it, because every stored hash is over an HMAC keyed with it
// rather than over the password.
//
// It is therefore a SHARED SECRET BETWEEN TWO APPLICATIONS. Rotating it
// invalidates every password in both at once and forces a universal reset.
// Both must be changed together.
//
// Read at call time rather than at module load: a Function can be started
// before its settings are applied, and caching an empty string here would
// silently produce hashes nobody can ever verify.
// ---------------------------------------------------------------------------
function pepper() {
  return process.env.AUTH_PEPPER || ''
}

// Matches Security.cfc's `bcryptRounds` and `bcryptVersion`.
const BCRYPT_ROUNDS = 12
const BCRYPT_VERSION = '$2b'

// Goes into auth.UserPasswords.Algorithm. ColdFusion writes
// "bcrypt-" & rounds, so this must produce the identical string -- the column
// is how each app decides whether it can verify a given row at all.
const PASSWORD_ALGORITHM = `bcrypt-${BCRYPT_ROUNDS}`

// ---------------------------------------------------------------------------
// preparePassword -- Security.cfc's prepareForBcrypt(), reproduced exactly.
//
// Two problems solved at once, and the comments there are worth repeating
// because getting either wrong breaks interop silently rather than loudly:
//
//   1. bcrypt truncates at 72 bytes and stops at the first null byte. A
//      90-character passphrase would have its tail ignored. Pre-hashing to 64
//      hex characters removes the cliff -- and hex specifically, because
//      base64 has a documented null-byte interaction. Hex is pure ASCII.
//
//   2. The pepper is applied here, via HMAC, so it never reaches the database.
//
// ColdFusion's hash()/hmac() return UPPERCASE hex and are wrapped in lCase().
// Node's digest('hex') is already lower case, so the two agree -- but that is
// a coincidence worth stating, since an upper-case digest here would produce
// hashes ColdFusion could never verify.
// ---------------------------------------------------------------------------
function preparePassword(password) {
  const normalised = password.normalize('NFC')
  const key = pepper()

  if (key.length) {
    return crypto.createHmac('sha256', Buffer.from(key, 'utf8')).update(normalised, 'utf8').digest('hex')
  }
  // The no-pepper branch exists because Security.cfc has it. It must never be
  // taken in production -- a missing AUTH_PEPPER would otherwise hash happily
  // and produce rows the ColdFusion app cannot verify. Callers check.
  return crypto.createHash('sha256').update(normalised, 'utf8').digest('hex')
}

function isPepperConfigured() {
  return pepper().length > 0
}

async function hashPassword(password) {
  // bcryptjs, not bcrypt: the native package compiles at install time on a CI
  // runner we do not control, and a build failure there is a deploy that dies
  // in a compiler error. Measured at 333 ms to hash and 316 ms to verify at
  // these settings, which is the cost we want anyway.
  //
  // genSalt is given the version explicitly so the output carries $2b$ and
  // matches what ColdFusion writes.
  const salt = await bcrypt.genSalt(BCRYPT_ROUNDS, BCRYPT_VERSION.slice(1))
  return bcrypt.hash(preparePassword(password), salt)
}

async function verifyPassword(password, stored, algorithm) {
  if (typeof password !== 'string' || password.length === 0) return false
  if (typeof stored !== 'string' || stored.length === 0) return false

  // auth.UserPasswords.Algorithm records what wrote the row. Anything that is
  // not a bcrypt variant is refused rather than guessed at -- the scrypt rows
  // this file used to write are exactly that case.
  if (algorithm && !/^bcrypt(-\d+)?$/.test(algorithm)) return false

  try {
    // bcrypt.compare is constant-time internally and reads the cost and salt
    // out of the stored string, so a row written at a different cost still
    // verifies. That is what makes raising BCRYPT_ROUNDS later safe.
    return await bcrypt.compare(preparePassword(password), stored)
  } catch {
    // A malformed stored hash must be a refusal, not a throw: a throw on the
    // login route is a 500, and a 500 on login is a denial of service.
    return false
  }
}

// Does this stored hash use a weaker version or cost than we now require?
// Mirrors needsRehash() in Security.cfc, including checking BOTH -- comparing
// only the cost would leave every $2a$12$ row reporting "fine forever" and the
// version migration would never happen.
function needsRehash(stored) {
  if (typeof stored !== 'string') return true

  const m = /^\$(2[aby])\$(\d{2})\$/.exec(stored)
  if (!m) return true

  return `$${m[1]}` !== BCRYPT_VERSION || Number(m[2]) < BCRYPT_ROUNDS
}

// ---------------------------------------------------------------------------
// Single-use tokens: the emailed registration and reset links, and the session
// cookie.
//
// 32 random bytes from the OS CSPRNG. Not a timestamp, not a counter -- the
// 2023 ColdFusion original derived its "temporary password" from the request
// clock, so whoever triggered the reset could compute it.
//
// Stored as a plain SHA-256 rather than bcrypt, which is correct and not a
// shortcut: these are already 256 bits of pure randomness, so there is no
// low-entropy secret to brute-force and no reason to pay a slow KDF on every
// request. Security.cfc says the same thing in its own words.
// ---------------------------------------------------------------------------
function mintToken() {
  const token = crypto.randomBytes(32).toString('base64url')
  return { token, lookup: hashToken(token) }
}

// Lower-case hex, 64 characters. NOT a Buffer, even though the columns are
// binary(32): every stored procedure takes @TokenHashHex as varchar(64) and
// does the conversion itself. The proc signature is the contract, not the
// column type.
function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex')
}

// ---------------------------------------------------------------------------
// The session cookie.
// ---------------------------------------------------------------------------
const SESSION_COOKIE = 'lb_session'

// 480 minutes -- the same eight hours Security.cfc uses, so a session means
// the same thing in both apps even though the cookies are separate.
const SESSION_MAX_AGE_S = 480 * 60

function sessionCookie(token, maxAgeSeconds = SESSION_MAX_AGE_S) {
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    // HttpOnly: JavaScript cannot read it, so an XSS bug cannot steal the
    // session. The single most valuable flag here.
    'HttpOnly',
    // Secure: never sent over plain HTTP. Static Web Apps is HTTPS-only.
    'Secure',
    // Lax, not Strict. Strict drops the cookie on the first navigation in from
    // an emailed link, which is how people arrive. Lax still refuses to send
    // it on a cross-site POST, which is the case CSRF needs.
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ')
}

// Max-Age=0 with an empty value. Expiring a cookie is the only way to delete
// one; there is no delete.
function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

function readSessionToken(request) {
  const header = request.headers.get('cookie')
  if (!header) return null

  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue

    const value = part.slice(eq + 1).trim()
    return value || null
  }
  return null
}

// ---------------------------------------------------------------------------
// Email addresses.
//
// Deliberately loose. The only test that means anything is whether mail to it
// arrives, which registration performs anyway by sending a link there.
// ---------------------------------------------------------------------------
function normaliseEmail(value) {
  if (typeof value !== 'string') return null

  // Lower-cased so one person cannot hold two accounts differing only in case.
  // auth.Users.EmailNormalized is the unique key and ColdFusion lower-cases
  // it the same way, so both apps find the same row.
  const email = value.trim().toLowerCase()

  if (email.length < 3 || email.length > 254) return null

  // The final segment must be at least two characters, because
  // CK_Users_EmailShape says Email LIKE '%_@_%.__%'. Anything this accepts and
  // the constraint rejects arrives as a 500 from a failed INSERT instead of a
  // 400 naming the field, so the looser of the two rules has to be the
  // database's.
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/.test(email)) return null
  return email
}

module.exports = {
  preparePassword,
  isPepperConfigured,
  hashPassword,
  verifyPassword,
  needsRehash,
  mintToken,
  hashToken,
  sessionCookie,
  clearSessionCookie,
  readSessionToken,
  normaliseEmail,
  PASSWORD_ALGORITHM,
  BCRYPT_ROUNDS,
  BCRYPT_VERSION,
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
}
