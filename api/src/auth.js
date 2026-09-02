const crypto = require('node:crypto')
const { promisify } = require('node:util')

const scrypt = promisify(crypto.scrypt)

// ---------------------------------------------------------------------------
// The cryptographic core of the login. Pure functions, no database, no HTTP --
// so it can be reasoned about, and eventually tested, on its own.
//
// Nothing in here is novel, and that is the point. Every choice below is the
// boring one; the interesting ones are how people lose password databases.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Password hashing: scrypt, from Node's own crypto module.
//
// Why not bcrypt: the `bcrypt` package is a native module compiled at install
// time, and the machine that builds this deploy is a GitHub Actions runner we
// do not control. A native build failure there is a deploy that dies in a
// compiler error. `bcryptjs` avoids that by being pure JavaScript, but it is
// still a dependency, and scrypt ships in Node already.
//
// Why not argon2id, which is the current first recommendation: same native
// module problem, and no pure-JS fallback worth having.
//
// scrypt is memory-hard, which is the property that matters. A GPU can try
// billions of SHA-512 guesses a second -- which is exactly what the
// ColdFusion original stored -- because SHA-512 needs no memory. Making each
// guess cost 64 MB makes a GPU no better at this than a CPU.
// ---------------------------------------------------------------------------

// OWASP's scrypt guidance gives several equivalent-work settings; this is the
// N=2^16 / r=8 / p=2 one, about 64 MB per hash.
//
// These are recorded IN each hash rather than only here, so raising them later
// upgrades new passwords without invalidating existing ones -- see
// needsRehash().
const SCRYPT = { N: 65536, r: 8, p: 2, keylen: 32, saltBytes: 16 }

// Goes into auth.UserPasswords.Algorithm on every row this code writes.
//
// That column is why the one bcrypt password already in the table is a choice
// rather than a problem: two algorithms can coexist while a migration runs.
// We do not implement bcrypt -- one account does not justify a dependency, and
// every candidate is either a native module that can fail the CI build or a
// pure-JS reimplementation to be trusted -- so verifyPassword refuses any
// algorithm it does not know instead of guessing at the format.
const PASSWORD_ALGORITHM = 'scrypt'

// Node caps scrypt's memory at 32 MB by default and throws above it. The real
// requirement is 128 * N * r, which for the settings above is 64 MB, so the
// default would reject every hash we ask for. Doubling it leaves headroom to
// raise N later without tripping over this again.
const SCRYPT_MAXMEM = 128 * SCRYPT.N * SCRYPT.r * 2

async function derive(password, salt, params) {
  // Normalise to NFC first. Two visually identical passwords can be different
  // byte sequences in Unicode -- an accented character composed one way or
  // two -- and a password typed on a Mac then re-typed on Windows should not
  // stop working.
  const normalised = password.normalize('NFC')
  return scrypt(normalised, salt, params.keylen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: SCRYPT_MAXMEM,
  })
}

// Stored form:  scrypt$N$r$p$<salt base64>$<hash base64>
//
// Self-describing, like bcrypt's. The parameters travel with the hash, so
// verification uses whatever settings produced it rather than today's, and
// old hashes keep working after the cost is raised.
async function hashPassword(password) {
  const salt = crypto.randomBytes(SCRYPT.saltBytes)
  const hash = await derive(password, salt, SCRYPT)
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$')
}

function parseStored(stored) {
  if (typeof stored !== 'string') return null
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null

  const [, N, r, p, salt, hash] = parts
  const params = { N: Number(N), r: Number(r), p: Number(p) }
  if (!Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) {
    return null
  }

  const saltBuf = Buffer.from(salt, 'base64')
  const hashBuf = Buffer.from(hash, 'base64')
  if (!saltBuf.length || !hashBuf.length) return null

  return { params: { ...params, keylen: hashBuf.length }, salt: saltBuf, hash: hashBuf }
}

async function verifyPassword(password, stored, algorithm = PASSWORD_ALGORITHM) {
  // auth.UserPasswords records the algorithm beside the hash, so this does not
  // have to be inferred from the shape of the string. Anything we do not
  // implement is refused outright rather than guessed at -- a bcrypt hash fed
  // to the scrypt parser would simply fail to parse, but relying on that is
  // relying on an accident.
  if (algorithm !== PASSWORD_ALGORITHM) return false

  const parsed = parseStored(stored)

  // An unparseable stored value means a row this code did not write. Refuse
  // it rather than reaching for a fallback: the ColdFusion original's login
  // had exactly that fallback -- "or the password matches in plaintext" -- and
  // it is the reason none of those credentials can be trusted.
  if (!parsed) return false

  if (typeof password !== 'string' || password.length === 0) return false

  const candidate = await derive(password, parsed.salt, parsed.params)

  // timingSafeEqual, not ===. String comparison stops at the first differing
  // byte, so how long it takes leaks how much of the guess was right. It also
  // throws on length mismatch, which parseStored has already made impossible.
  if (candidate.length !== parsed.hash.length) return false
  return crypto.timingSafeEqual(candidate, parsed.hash)
}

// True when a stored hash was made with weaker settings than today's. Call it
// after a successful login, while the plaintext is in hand and re-hashing is
// free -- it is the only moment the upgrade can happen.
function needsRehash(stored) {
  const parsed = parseStored(stored)
  if (!parsed) return true
  const { N, r, p, keylen } = parsed.params
  return N < SCRYPT.N || r < SCRYPT.r || p < SCRYPT.p || keylen < SCRYPT.keylen
}

// ---------------------------------------------------------------------------
// Single-use tokens: the emailed registration and password-reset links, and
// the session cookie.
//
// 32 random bytes from the OS CSPRNG. Not a timestamp, not a counter, not
// anything derived from the user -- the ColdFusion original's "temporary
// password" was the request time with the dot removed, which anyone who
// triggered the reset could compute.
//
// What is stored is the SHA-256 of the token, never the token. If the table
// leaks, the rows in it cannot be used to log in or to complete a reset. This
// is the same reasoning as password hashing, minus the need for a slow KDF:
// the input here already has 256 bits of entropy, so there is nothing to
// brute-force and no reason to pay scrypt's cost on every request.
// ---------------------------------------------------------------------------
function mintToken() {
  // base64url: safe in a URL and in a cookie with no escaping, which is where
  // both of these end up.
  const token = crypto.randomBytes(32).toString('base64url')
  return { token, lookup: hashToken(token) }
}

// Returns a Buffer, not hex, because auth.SecurityTokens.TokenHash and
// auth.Sessions.TokenHash are binary(32) -- half the storage of hex, and it
// removes the question of whether the column is upper or lower case, which is
// the kind of mismatch that makes a lookup silently return nothing.
//
// mssql maps a Buffer to VarBinary directly, so this goes into a parameter
// with no conversion at either end.
function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest()
}

// ---------------------------------------------------------------------------
// The session cookie.
// ---------------------------------------------------------------------------
const SESSION_COOKIE = 'lb_session'

// Eight hours: a shift. Long enough that a driver checking a statement is not
// asked to log in twice, short enough that a session left open on a shared
// terminal in a truck stop expires on its own.
const SESSION_MAX_AGE_S = 8 * 60 * 60

function sessionCookie(token, maxAgeSeconds = SESSION_MAX_AGE_S) {
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    // HttpOnly: JavaScript cannot read it, so an XSS bug on the page cannot
    // steal the session. This is the single most valuable flag here.
    'HttpOnly',
    // Secure: never sent over plain HTTP. Static Web Apps is HTTPS-only, so
    // this costs nothing and closes the downgrade case.
    'Secure',
    // Lax, not Strict. Strict would drop the cookie on the first navigation
    // in from an emailed link, which is exactly how people arrive here. Lax
    // still refuses to send it on a cross-site POST, which is the case CSRF
    // actually needs.
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ')
}

// Max-Age=0 with an empty value. Setting a cookie to expire is the only way to
// delete one; there is no delete.
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
// arrives, which the registration flow performs anyway by sending a link there
// -- so this rejects the obviously malformed and gets out of the way. A strict
// regex here would reject valid addresses and prove nothing about the rest.
// ---------------------------------------------------------------------------
function normaliseEmail(value) {
  if (typeof value !== 'string') return null

  // Lower-cased so one person cannot hold two accounts differing only in case.
  // The local part is technically case-sensitive; no mail provider anyone uses
  // treats it that way, and matching their behaviour beats matching the RFC.
  const email = value.trim().toLowerCase()

  // 254 is the longest address that can actually be delivered. The column is
  // NVARCHAR(320) -- the theoretical maximum, 64 for the local part plus 255
  // for the domain -- so this is stricter than the schema on purpose: an
  // address the mail system cannot reach is not one worth storing, and the
  // registration link would go nowhere.
  if (email.length < 3 || email.length > 254) return null

  // The final segment must be at least two characters, because
  // CK_Users_EmailShape in the database says so: Email LIKE '%_@_%.__%'.
  // Anything this accepts and the constraint rejects arrives as a 500 from a
  // failed INSERT instead of a 400 naming the field -- so the looser of the
  // two rules has to be the database's, never this one.
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/.test(email)) return null
  return email
}

module.exports = {
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
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
}
