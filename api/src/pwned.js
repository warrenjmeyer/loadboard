const crypto = require('node:crypto')

// ---------------------------------------------------------------------------
// Screening new passwords against Have I Been Pwned.
//
// This is the highest-value check in the whole login, and it is worth being
// clear about why. Every composition rule ever written ("one uppercase, one
// digit, one symbol") is a guess about what attackers try. This is not a
// guess: it is the actual list, hundreds of millions of passwords that have
// appeared in real breaches, and those are the ones tried first. A password
// nobody has ever leaked beats a password that satisfies every rule.
//
// It is also why current NIST guidance drops composition rules and adds this
// instead. We do both halves: no rules, and this.
// ---------------------------------------------------------------------------

// k-anonymity. We send the FIRST FIVE characters of the hash and nothing else.
// The response is every known suffix sharing that prefix -- on the order of
// 500-1000 of them -- and the comparison happens here. The password never
// leaves this process, and the service cannot tell which of the candidates
// was being asked about, or even whether any of them was.
const RANGE_URL = 'https://api.pwnedpasswords.com/range/'

// Three seconds. This runs while someone is waiting on a form submit, and the
// answer is advisory -- see the fail-open decision below -- so it is not worth
// making them wait longer than that to be told something we will not act on.
const TIMEOUT_MS = 3000

// SHA-1 is not a security choice here and must not be "fixed" to something
// stronger: it is the API's contract, and the range endpoint is indexed by
// SHA-1 prefix. Nothing is being protected by this hash. The password's
// secrecy comes from only five characters of it leaving the process, not from
// the algorithm.
function sha1Hex(password) {
  return crypto.createHash('sha1').update(password.normalize('NFC'), 'utf8').digest('hex').toUpperCase()
}

// The body is one "SUFFIX:COUNT" per line. Returns the count for our suffix,
// or 0 if it is not in the list.
//
// Entries with a count of zero are padding, not data -- see the Add-Padding
// header below -- so a zero result and an absent one mean the same thing and
// are treated the same way.
function countInRange(body, suffix) {
  for (const line of body.split('\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    if (line.slice(0, colon).trim().toUpperCase() !== suffix) continue

    const count = Number.parseInt(line.slice(colon + 1).trim(), 10)
    return Number.isFinite(count) ? count : 0
  }
  return 0
}

// `fetchImpl` exists so the tests can drive this without a network. Production
// callers pass nothing and get global fetch.
async function pwnedCount(password, fetchImpl = globalThis.fetch) {
  if (typeof password !== 'string' || password.length === 0) {
    return { checked: true, count: 0 }
  }

  const hash = sha1Hex(password)
  const prefix = hash.slice(0, 5)
  const suffix = hash.slice(5)

  try {
    const res = await fetchImpl(RANGE_URL + prefix, {
      headers: {
        // Padding makes every response a similar size by mixing in dummy
        // entries with a count of zero. Without it, response length is a
        // side channel: an observer watching encrypted traffic can infer
        // something about which range was requested.
        'Add-Padding': 'true',
        'User-Agent': 'loadboard-wjm',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!res.ok) return { checked: false, count: 0 }

    return { checked: true, count: countInRange(await res.text(), suffix) }
  } catch {
    // Network failure, timeout, DNS, an outage at their end.
    return { checked: false, count: 0 }
  }
}

// ---------------------------------------------------------------------------
// Fail OPEN, deliberately.
//
// `checked: false` means we could not reach the service, and the caller lets
// the password through. The alternative -- refuse every password while HIBP
// is unreachable -- means their outage becomes our outage, and nobody can
// register or reset. That trade is wrong: this check strengthens a password
// policy, it is not the thing standing between an attacker and an account.
// scrypt, rate limiting and the session rules are, and none of them depend on
// a third party being up.
//
// The caller should log the miss. A run of them is worth knowing about.
// ---------------------------------------------------------------------------
async function isPasswordBreached(password, fetchImpl) {
  const { checked, count } = await pwnedCount(password, fetchImpl)
  return { breached: count > 0, count, checked }
}

module.exports = { isPasswordBreached, pwnedCount, countInRange, sha1Hex }
