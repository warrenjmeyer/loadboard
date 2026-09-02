// A fixed pepper, set before auth.js is required, so these are deterministic
// and never depend on the real one in the Function App's settings.
process.env.AUTH_PEPPER = 'test-pepper-do-not-use-in-production-0000000'

const test = require('node:test')
const assert = require('node:assert')
const crypto = require('node:crypto')
const bcrypt = require('bcryptjs')
const auth = require('./auth.js')

// ---------------------------------------------------------------------------
// Run with:  npm test
//
// This is the file where a mistake is silent. A broken load board is obvious
// on sight; a password comparison that always returns true looks exactly like
// one that works.
//
// The tests that matter most here are the interop ones. This app shares its
// accounts with the ColdFusion app at C:\Websites\app-scaffold, so a password
// set in one has to verify in the other. Nothing in either codebase enforces
// that -- only these assertions do.
// ---------------------------------------------------------------------------

test('preparePassword reproduces prepareForBcrypt from Security.cfc', () => {
  const password = 'correct horse battery staple'

  // Security.cfc, with a pepper configured:
  //     lCase(hmac(password, pepperKey, "HMACSHA256", "utf-8"))
  const expected = crypto
    .createHmac('sha256', Buffer.from(process.env.AUTH_PEPPER, 'utf8'))
    .update(password, 'utf8')
    .digest('hex')

  assert.strictEqual(auth.preparePassword(password), expected)

  // 64 lower-case hex characters. Lower case matters: ColdFusion's hmac()
  // returns upper case and is wrapped in lCase(), so an upper-case digest here
  // would produce hashes ColdFusion could never verify.
  assert.match(auth.preparePassword(password), /^[0-9a-f]{64}$/)

  // Fixed length is the point -- bcrypt truncates at 72 bytes and stops at any
  // null byte, so a long passphrase would otherwise have its tail ignored.
  assert.strictEqual(auth.preparePassword('x').length, 64)
  assert.strictEqual(auth.preparePassword('y'.repeat(500)).length, 64)
})

test('the pepper actually participates', async () => {
  const stored = await auth.hashPassword('correct horse battery staple')

  // Same password, different pepper, must not verify. If it does, the pepper
  // is decorative and a stolen database is crackable on its own.
  const original = process.env.AUTH_PEPPER
  try {
    process.env.AUTH_PEPPER = 'a completely different pepper value'
    assert.strictEqual(await auth.verifyPassword('correct horse battery staple', stored), false)
  } finally {
    process.env.AUTH_PEPPER = original
  }

  assert.strictEqual(await auth.verifyPassword('correct horse battery staple', stored), true)
})

test('a hash matches what ColdFusion writes: $2b, cost 12, 60 chars', async () => {
  const stored = await auth.hashPassword('correct horse battery staple')

  assert.ok(stored.startsWith('$2b$12$'), stored.slice(0, 7))
  assert.strictEqual(stored.length, 60)
  assert.strictEqual(auth.PASSWORD_ALGORITHM, 'bcrypt-12')

  // Two hashes of one password must differ, or the salt is decorative.
  const again = await auth.hashPassword('correct horse battery staple')
  assert.notStrictEqual(stored, again)
  assert.ok(await auth.verifyPassword('correct horse battery staple', again))
})

test('a hash written the ColdFusion way verifies here', async () => {
  // Built from the primitives rather than through hashPassword, so this fails
  // if our recipe drifts from theirs even though our own round trip still works.
  const password = 'a passphrase typed into the ColdFusion app'
  const prehash = crypto
    .createHmac('sha256', Buffer.from(process.env.AUTH_PEPPER, 'utf8'))
    .update(password, 'utf8')
    .digest('hex')
  const asColdFusionWouldStore = await bcrypt.hash(prehash, await bcrypt.genSalt(12, 'b'))

  assert.strictEqual(await auth.verifyPassword(password, asColdFusionWouldStore, 'bcrypt-12'), true)
  assert.strictEqual(await auth.verifyPassword('wrong', asColdFusionWouldStore, 'bcrypt-12'), false)
})

test('verify accepts the right password and nothing else', async () => {
  const stored = await auth.hashPassword('correct horse battery staple')

  assert.strictEqual(await auth.verifyPassword('correct horse battery staple', stored), true)
  assert.strictEqual(await auth.verifyPassword('Correct horse battery staple', stored), false)
  assert.strictEqual(await auth.verifyPassword('', stored), false)
})

test('a password survives being retyped on another platform', async () => {
  // The same eight characters, composed two ways in Unicode. A password set on
  // one OS and typed on another can arrive as either.
  const composed = 'passwörd'.normalize('NFC')
  const decomposed = 'passwörd'.normalize('NFD')
  assert.notStrictEqual(composed, decomposed)

  const stored = await auth.hashPassword(decomposed)
  assert.strictEqual(await auth.verifyPassword(composed, stored), true)
})

test('a long passphrase is not silently truncated', async () => {
  // Without the hex pre-hash, bcrypt would ignore everything past 72 bytes and
  // these two would be the same password.
  const a = 'x'.repeat(80) + 'ending-one'
  const b = 'x'.repeat(80) + 'ending-two'

  const stored = await auth.hashPassword(a)
  assert.strictEqual(await auth.verifyPassword(a, stored), true)
  assert.strictEqual(await auth.verifyPassword(b, stored), false)
})

test('algorithms we do not implement are refused, not guessed at', async () => {
  const stored = await auth.hashPassword('correct horse battery staple')

  // The scrypt rows this file used to write.
  assert.strictEqual(await auth.verifyPassword('x', 'scrypt$65536$8$2$c2FsdA==$aGFzaA==', 'scrypt'), false)
  assert.strictEqual(await auth.verifyPassword('correct horse battery staple', stored, 'scrypt'), false)

  // Both spellings ColdFusion might have written.
  assert.strictEqual(await auth.verifyPassword('correct horse battery staple', stored, 'bcrypt'), true)
  assert.strictEqual(await auth.verifyPassword('correct horse battery staple', stored, 'bcrypt-12'), true)

  // Malformed input is a refusal, not a throw. A throw on the login route is a
  // 500, and a 500 on login is a denial of service.
  for (const junk of [null, undefined, '', '$2b$', 'not-a-hash', 42, {}]) {
    assert.strictEqual(await auth.verifyPassword('x', junk), false)
  }
})

test('needsRehash checks version as well as cost', () => {
  assert.strictEqual(auth.needsRehash('$2b$12$' + 'a'.repeat(53)), false)
  assert.strictEqual(auth.needsRehash('$2b$10$' + 'a'.repeat(53)), true)

  // Comparing only the cost would leave every $2a$12$ row reporting "fine
  // forever", so the version migration would never happen.
  assert.strictEqual(auth.needsRehash('$2a$12$' + 'a'.repeat(53)), true)
  assert.strictEqual(auth.needsRehash('not-a-hash'), true)
  assert.strictEqual(auth.needsRehash(null), true)
})

test('tokens are random, url-safe, and stored only as a hash', () => {
  const { token, lookup } = auth.mintToken()

  assert.strictEqual(token.length, 43) // 32 bytes as base64url
  assert.strictEqual(token, encodeURIComponent(token)) // safe in an emailed link

  // Lower-case hex, 64 chars: what every stored procedure takes as
  // @TokenHashHex VARCHAR(64). Not a Buffer, even though the column is
  // binary(32) -- the procedure does the conversion.
  assert.match(lookup, /^[0-9a-f]{64}$/)
  assert.strictEqual(auth.hashToken(token), lookup)
  assert.notStrictEqual(token, lookup)

  // Matches ColdFusion's hashToken(): lCase(hash(token, "SHA-256", "utf-8")).
  assert.strictEqual(lookup, crypto.createHash('sha256').update(token, 'utf8').digest('hex'))

  // Distinct every time. The 2023 original derived this from the clock, so
  // whoever asked for the reset could compute it.
  const seen = new Set()
  for (let i = 0; i < 500; i++) seen.add(auth.mintToken().token)
  assert.strictEqual(seen.size, 500)
})

test('the session cookie is a Cookie object with every flag that matters', () => {
  const cookie = auth.sessionCookie('abc')

  // An OBJECT, not a Set-Cookie string. Returning a string is why the deployed
  // login sent no Set-Cookie header at all -- @azure/functions serialises
  // these fields itself and silently discards anything else.
  assert.strictEqual(typeof cookie, 'object')
  assert.strictEqual(cookie.name, 'lb_session')
  assert.strictEqual(cookie.value, 'abc')
  assert.strictEqual(cookie.path, '/')
  assert.strictEqual(cookie.httpOnly, true)
  assert.strictEqual(cookie.secure, true)
  assert.strictEqual(cookie.sameSite, 'Lax')

  // 480 minutes, the same eight hours Security.cfc uses.
  assert.strictEqual(auth.SESSION_MAX_AGE_S, 480 * 60)
  assert.strictEqual(cookie.maxAge, 480 * 60)

  // Every field the runtime knows about is spelled the way it expects. A typo
  // here does not throw -- it just quietly drops that attribute.
  for (const key of Object.keys(cookie)) {
    assert.ok(
      ['name', 'value', 'domain', 'path', 'expires', 'secure', 'httpOnly', 'sameSite', 'maxAge'].includes(key),
      `unknown Cookie field "${key}" -- the runtime will ignore it`
    )
  }
})

test('clearing the cookie expires it and matches the original', () => {
  const set = auth.sessionCookie('abc')
  const clear = auth.clearSessionCookie()

  assert.strictEqual(clear.maxAge, 0)
  assert.strictEqual(clear.value, '')

  // A browser treats a cookie with a different path or flags as a DIFFERENT
  // cookie and leaves the original in place, so signing out would not.
  for (const key of ['name', 'path', 'httpOnly', 'secure', 'sameSite']) {
    assert.strictEqual(clear[key], set[key], `${key} must match or the original survives`)
  }
})

test('the session token is found among other cookies', () => {
  const req = (cookie) => ({ headers: { get: (n) => (n === 'cookie' ? cookie : null) } })

  assert.strictEqual(auth.readSessionToken(req('a=1; lb_session=wanted; z=2')), 'wanted')
  assert.strictEqual(auth.readSessionToken(req('lb_session=wanted')), 'wanted')
  assert.strictEqual(auth.readSessionToken(req('xlb_session=no')), null)
  assert.strictEqual(auth.readSessionToken(req('lb_session=')), null)
  assert.strictEqual(auth.readSessionToken(req('nothing=here')), null)
  assert.strictEqual(auth.readSessionToken(req(null)), null)
})

test('email addresses are normalised, and junk is rejected', () => {
  assert.strictEqual(auth.normaliseEmail('  Warren@Example.COM '), 'warren@example.com')
  assert.strictEqual(auth.normaliseEmail('a@b.co'), 'a@b.co')
  assert.strictEqual(auth.normaliseEmail('warren@example.co.uk'), 'warren@example.co.uk')

  for (const bad of ['no-at-sign', 'a@b', 'a b@c.com', '@b.com', 'a@', '', null, 42, 'a@b..com']) {
    assert.strictEqual(auth.normaliseEmail(bad), null, `should reject ${JSON.stringify(bad)}`)
  }

  // CK_Users_EmailShape is Email LIKE '%_@_%.__%' -- two characters after the
  // final dot. Accepting this would turn a 400 naming the field into a 500
  // from a failed INSERT.
  assert.strictEqual(auth.normaliseEmail('a@b.c'), null)
})

test('a missing pepper is detectable', () => {
  const original = process.env.AUTH_PEPPER
  try {
    assert.strictEqual(auth.isPepperConfigured(), true)
    delete process.env.AUTH_PEPPER
    // Callers check this rather than hashing happily and writing rows the
    // ColdFusion app could never verify.
    assert.strictEqual(auth.isPepperConfigured(), false)
  } finally {
    process.env.AUTH_PEPPER = original
  }
})
