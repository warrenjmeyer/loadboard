const test = require('node:test')
const assert = require('node:assert')
const auth = require('./auth.js')

// ---------------------------------------------------------------------------
// Run with:  node --test api/src
//
// The first tests in this repo, and they are here rather than anywhere else
// because this is the file where a mistake is silent. A broken load board is
// obvious on sight; a broken password comparison looks exactly like a working
// one until someone else notices.
//
// No test framework. Node has had a runner built in since 18, and adding
// dependencies to the Function App is the thing this module went out of its
// way to avoid in the first place.
// ---------------------------------------------------------------------------

test('a hash is self-describing and salted', async () => {
  const stored = await auth.hashPassword('correct horse battery staple')

  assert.match(stored, /^scrypt\$65536\$8\$2\$[^$]+\$[^$]+$/)

  // The same password twice must not produce the same hash. If it does, the
  // salt is not doing anything, and one rainbow table covers every user.
  const again = await auth.hashPassword('correct horse battery staple')
  assert.notStrictEqual(stored, again)
  assert.ok(await auth.verifyPassword('correct horse battery staple', again))
})

test('verify accepts the right password and nothing else', async () => {
  const stored = await auth.hashPassword('correct horse battery staple')

  assert.strictEqual(await auth.verifyPassword('correct horse battery staple', stored), true)
  assert.strictEqual(await auth.verifyPassword('Correct horse battery staple', stored), false)
  assert.strictEqual(await auth.verifyPassword('correct horse battery stapl', stored), false)
  assert.strictEqual(await auth.verifyPassword('', stored), false)
})

test('a password survives being retyped on another platform', async () => {
  // The same eight characters, composed two different ways in Unicode. A
  // password set on one OS and typed on another can arrive as either.
  const composed = 'passwörd'.normalize('NFC')
  const decomposed = 'passwörd'.normalize('NFD')
  assert.notStrictEqual(composed, decomposed)

  const stored = await auth.hashPassword(decomposed)
  assert.strictEqual(await auth.verifyPassword(composed, stored), true)
})

test('legacy credentials are refused, not honoured', async () => {
  // What the ColdFusion original stored: unsalted SHA-512 as uppercase hex,
  // and in some rows the password itself. Its login accepted either, so any
  // of those may already be known. None of them may work here even once.
  const sha512 = 'A'.repeat(128)

  assert.strictEqual(await auth.verifyPassword('anything', sha512), false)
  assert.strictEqual(await auth.verifyPassword('plaintext', 'plaintext'), false)

  // And malformed input must be a refusal rather than a crash -- a throw here
  // would be a 500 on the login route, which is a denial of service.
  for (const junk of [null, undefined, '', 'scrypt$', 'scrypt$a$b$c$d$e', 42, {}]) {
    assert.strictEqual(await auth.verifyPassword('x', junk), false)
  }
})

test('needsRehash spots hashes made with weaker settings', () => {
  assert.strictEqual(auth.needsRehash('scrypt$65536$8$2$c2FsdA==$' + 'A'.repeat(43) + '='), false)
  assert.strictEqual(auth.needsRehash('scrypt$16384$8$1$c2FsdA==$' + 'A'.repeat(43) + '='), true)
  assert.strictEqual(auth.needsRehash('A'.repeat(128)), true)
  assert.strictEqual(auth.needsRehash(null), true)
})

test('tokens are random, url-safe, and stored only as a hash', () => {
  const { token, lookup } = auth.mintToken()

  // 32 bytes as base64url.
  assert.strictEqual(token.length, 43)

  // Safe in a URL with no escaping -- these travel in an emailed link.
  assert.strictEqual(token, encodeURIComponent(token))

  // What goes in the database is not what goes in the email, and it is a
  // Buffer because SecurityTokens.TokenHash and Sessions.TokenHash are
  // binary(32).
  assert.ok(Buffer.isBuffer(lookup))
  assert.strictEqual(lookup.length, 32)
  assert.ok(lookup.equals(auth.hashToken(token)))
  assert.ok(!lookup.equals(Buffer.from(token)))

  // Distinct every time. The 2023 original derived this from the clock, so
  // whoever asked for the reset could compute it.
  const seen = new Set()
  for (let i = 0; i < 500; i++) seen.add(auth.mintToken().token)
  assert.strictEqual(seen.size, 500)

  // And distinct hashes, not just distinct tokens.
  const hashes = new Set()
  for (let i = 0; i < 500; i++) hashes.add(auth.mintToken().lookup.toString('hex'))
  assert.strictEqual(hashes.size, 500)
})

test('an algorithm we do not implement is refused, not guessed at', async () => {
  const stored = await auth.hashPassword('correct horse battery staple')

  // The row already in auth.UserPasswords is bcrypt. Feeding its hash to the
  // scrypt parser would fail anyway, but the refusal must be deliberate --
  // relying on a parse failure is relying on an accident.
  assert.strictEqual(
    await auth.verifyPassword('correct horse battery staple', stored, 'bcrypt'),
    false
  )
  assert.strictEqual(await auth.verifyPassword('x', '$2b$12$' + 'a'.repeat(53), 'bcrypt'), false)

  // The default is our own algorithm, so existing callers are unaffected.
  assert.strictEqual(auth.PASSWORD_ALGORITHM, 'scrypt')
  assert.strictEqual(await auth.verifyPassword('correct horse battery staple', stored), true)
})

test('the session cookie carries every flag that matters', () => {
  const cookie = auth.sessionCookie('abc')

  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) {
    assert.ok(cookie.includes(flag), `missing ${flag}`)
  }
  assert.ok(cookie.includes(`Max-Age=${auth.SESSION_MAX_AGE_S}`))

  // Deleting a cookie means expiring it; there is no delete.
  assert.ok(auth.clearSessionCookie().includes('Max-Age=0'))
})

test('the session token is found among other cookies', () => {
  const req = (cookie) => ({ headers: { get: (n) => (n === 'cookie' ? cookie : null) } })

  assert.strictEqual(auth.readSessionToken(req('a=1; lb_session=wanted; z=2')), 'wanted')
  assert.strictEqual(auth.readSessionToken(req('lb_session=wanted')), 'wanted')

  // A cookie named similarly must not match.
  assert.strictEqual(auth.readSessionToken(req('xlb_session=no')), null)

  assert.strictEqual(auth.readSessionToken(req('lb_session=')), null)
  assert.strictEqual(auth.readSessionToken(req('nothing=here')), null)
  assert.strictEqual(auth.readSessionToken(req(null)), null)
})

test('email addresses are normalised, and junk is rejected', () => {
  assert.strictEqual(auth.normaliseEmail('  Warren@Example.COM '), 'warren@example.com')
  assert.strictEqual(auth.normaliseEmail('a@b.co'), 'a@b.co')

  for (const bad of ['no-at-sign', 'a@b', 'a b@c.com', '@b.com', 'a@', '', null, 42, 'a@b..com']) {
    assert.strictEqual(auth.normaliseEmail(bad), null, `should reject ${JSON.stringify(bad)}`)
  }

  // A one-character final segment. CK_Users_EmailShape in the database
  // (Email LIKE '%_@_%.__%') requires two, so accepting it here would turn a
  // 400 naming the field into a 500 from a failed INSERT. Whichever of the two
  // rules is looser has to be the database's.
  assert.strictEqual(auth.normaliseEmail('a@b.c'), null)
  assert.strictEqual(auth.normaliseEmail('a@b.co'), 'a@b.co')
  assert.strictEqual(auth.normaliseEmail('warren@example.co.uk'), 'warren@example.co.uk')
})
