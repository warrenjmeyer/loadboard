const test = require('node:test')
const assert = require('node:assert')
const crypto = require('node:crypto')
const { isPasswordBreached, pwnedCount, countInRange, sha1Hex } = require('./pwned.js')

// ---------------------------------------------------------------------------
// These do not touch the network. The HTTP call is injected, so the tests
// cover the parts that can actually be wrong -- what we send, what we do with
// the answer, and what happens when there is no answer -- without depending on
// a third party being up to tell us whether our own code works.
//
// The one test that does reach the internet is at the bottom, and skips itself
// when offline.
// ---------------------------------------------------------------------------

// 'password' -> SHA-1 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
const PASSWORD_SHA1 = '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8'

test('hashing matches the API contract: SHA-1, uppercase hex', () => {
  assert.strictEqual(sha1Hex('password'), PASSWORD_SHA1)
  assert.strictEqual(sha1Hex('password').length, 40)
  assert.match(sha1Hex('anything'), /^[0-9A-F]{40}$/)
})

test('only the first five hash characters would ever be sent', async () => {
  // A distinctive plaintext on purpose: the host is api.pwnedpasswords.com,
  // so asserting the URL does not contain "password" passes for the wrong
  // reason and fails for the wrong reason too.
  const secret = 'ossifrage-quixotic-47'
  const hash = sha1Hex(secret)

  let requested = null
  let sentBody
  const fake = async (url, init) => {
    requested = url
    sentBody = init && init.body
    return { ok: true, text: async () => '' }
  }

  await pwnedCount(secret, fake)

  // Exactly the prefix, nothing more.
  assert.strictEqual(requested, 'https://api.pwnedpasswords.com/range/' + hash.slice(0, 5))

  // The whole point: neither the password nor the rest of its hash leaves.
  assert.ok(!requested.includes(secret), 'plaintext in URL')
  assert.ok(!requested.includes(hash.slice(5)), 'hash suffix in URL')

  // And it is a GET with no body -- nothing smuggled out that way either.
  assert.strictEqual(sentBody, undefined)
})

test('a suffix present in the range is counted', () => {
  const body = ['0018A45C4D1DEF81644B54AB7F969B88D65:1', '00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2'].join('\r\n')

  assert.strictEqual(countInRange(body, '0018A45C4D1DEF81644B54AB7F969B88D65'), 1)
  assert.strictEqual(countInRange(body, '00D4F6E8FA6EECAD2A3AA415EEC418D38EC'), 2)
  assert.strictEqual(countInRange(body, 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'), 0)
})

test('padding entries are not treated as hits', () => {
  // Add-Padding mixes in decoy suffixes with a count of zero. Counting one as
  // a hit would reject a password that has never leaked.
  const body = ['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:0', 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB:5'].join('\n')

  assert.strictEqual(countInRange(body, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), 0)
  assert.strictEqual(countInRange(body, 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'), 5)
})

test('a breached password is reported with its count', async () => {
  const fake = async () => ({
    ok: true,
    text: async () => `${PASSWORD_SHA1.slice(5)}:12345678`,
  })

  const result = await isPasswordBreached('password', fake)
  assert.deepStrictEqual(result, { breached: true, count: 12345678, checked: true })
})

test('an unbreached password passes', async () => {
  const fake = async () => ({ ok: true, text: async () => 'FFFF:9' })

  const result = await isPasswordBreached('a passphrase nobody has used', fake)
  assert.deepStrictEqual(result, { breached: false, count: 0, checked: true })
})

test('an outage fails open, and says so', async () => {
  // If their service being down stopped anyone registering, their outage
  // would be ours. `checked: false` is how the caller knows to log it.
  const down = async () => {
    throw new Error('ECONNREFUSED')
  }
  assert.deepStrictEqual(await isPasswordBreached('anything', down), {
    breached: false,
    count: 0,
    checked: false,
  })

  const error500 = async () => ({ ok: false, text: async () => '' })
  assert.deepStrictEqual(await isPasswordBreached('anything', error500), {
    breached: false,
    count: 0,
    checked: false,
  })
})

test('malformed responses do not throw', async () => {
  for (const body of ['', 'garbage', ':::', 'ABC:notanumber', '\n\n\n']) {
    const fake = async () => ({ ok: true, text: async () => body })
    const result = await isPasswordBreached('password', fake)
    assert.strictEqual(result.breached, false)
  }
})

// ---------------------------------------------------------------------------
// The one live test. Skips rather than fails when there is no network, so
// this suite still runs on a plane.
// ---------------------------------------------------------------------------
test('live: HIBP knows "password" and does not know a random passphrase', async (t) => {
  const probe = await isPasswordBreached('password')
  if (!probe.checked) {
    t.skip('HIBP unreachable')
    return
  }

  assert.strictEqual(probe.breached, true)
  assert.ok(probe.count > 1000, `expected many hits, got ${probe.count}`)

  const random = `correct-horse-${crypto.randomUUID()}`
  const fresh = await isPasswordBreached(random)
  assert.strictEqual(fresh.breached, false)
})
