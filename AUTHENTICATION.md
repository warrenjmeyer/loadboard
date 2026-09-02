# Authentication

How people sign in, what they are then allowed to do, and why each piece is
shaped the way it is.

The short version: **this app does not own its accounts.** A ColdFusion app has
owned `Millstream.auth` since 19 August 2026, and this is a second caller of the
same system. Almost every constraint below follows from that.

---

## Contents

- [The shared schema](#the-shared-schema)
- [Passwords](#passwords)
- [Signing in](#signing-in)
- [Sessions](#sessions)
- [Registration, verification and reset](#registration-verification-and-reset)
- [Authorization](#authorization)
- [What the public can see](#what-the-public-can-see)
- [Configuration](#configuration)
- [Verifying it works](#verifying-it-works)
- [Platform behaviours that cost real outages](#platform-behaviours-that-cost-real-outages)
- [Runbook](#runbook)
- [Known gaps](#known-gaps)

---

## The shared schema

`C:\Websites\app-scaffold` is a ColdFusion 2025 app on port 8500. Its
`services/Security.cfc` owns eighteen stored procedures in `Millstream.auth`,
with peppered bcrypt, lockout, throttling and an audit trail. It was there
first and it is good.

So this app is a **second caller**, not a second implementation:

| | |
|---|---|
| **Accounts** | shared. One person, one password, both apps. |
| **Roles** | shared table, but only this app reads them (see below). |
| **Sessions** | *not* shared. Cookies do not cross origins, so `localhost:8500` and `azurestaticapps.net` are always separate sign-ins. |

**`api/src/authStore.js` is thin wrappers over the stored procedures.** It used
to write raw SQL at the tables. That worked and was still wrong: two
implementations of one rule drift, and the drift stays invisible until the day
one app locks an account the other still admits. Every rule that matters —
lockout, sliding expiry, single-use tokens, which failures count toward a
throttle — lives in exactly one place.

The two exceptions are `Users.Role` and `Users.DriverCode`, added by
`auth_01_roles.sql`. No shared procedure knows about them, and inventing one
would mean editing an API the ColdFusion app depends on, so those two columns
are the one place raw SQL is correct.

---

## Passwords

```
bcrypt($2b, cost 12, over lowercase-hex( HMAC-SHA256(password, AUTH_PEPPER) ))
```

This must match `prepareForBcrypt()` in `Security.cfc` **byte for byte**, or a
password set in one app will not verify in the other.

**Why the HMAC pre-hash**, and not just bcrypt:

- **The pepper.** A secret held outside the database — in the Function App's
  settings here, `config/env.json` there. Every stored hash is over an HMAC
  keyed with it, so a stolen database backup is uncrackable without also
  stealing the app server.
- **Fixed length.** bcrypt truncates at 72 bytes and stops at the first null
  byte, so a 90-character passphrase would silently lose its tail. Pre-hashing
  to 64 characters removes the cliff. **Hex, not base64** — base64 has a
  documented null-byte interaction; hex is pure ASCII.

ColdFusion's `hash()` and `hmac()` return **upper**-case hex and are wrapped in
`lCase()`. Node's `digest('hex')` is already lower case. The two agree, but that
is a coincidence worth stating: an upper-case digest here would produce hashes
ColdFusion could never verify.

**`bcryptjs`, not native `bcrypt`.** The machine that builds this deploy is a
GitHub Actions runner we do not control, and a native build failure there is a
deploy that dies in a compiler error. Measured: **333 ms to hash, 316 ms to
verify.** That cost is the point.

Stored in `auth.UserPasswords` as *history* — one row current
(`UX_UserPasswords_OneCurrent` is a unique index filtered to `IsCurrent = 1`),
the rest retired. That is what makes "you cannot reuse your last five" possible
later, and it forces `setPassword` to retire before it inserts.

**Policy** (matching `checkPasswordPolicy()` in `Security.cfc`): 12–128
characters, a common-password blocklist, and **the blocklist is checked first**.
That ordering is load-bearing — every entry shorter than twelve characters would
otherwise be unreachable, and the most-guessed passwords in the world are
exactly the short ones. `password` is eight characters and must still produce
the specific "too easily guessed" message.

**No composition rules.** Current NIST guidance drops them because they reliably
produce `Password1!`. In their place, `api/src/pwned.js` screens against Have I
Been Pwned by k-anonymity: only the first five characters of the SHA-1 leave the
process, so the password itself never does. It **fails open** — if the service
is unreachable the password is allowed, because their outage must not become
ours.

---

## Signing in

`POST /api/login`. The order below is the defence, not a style choice.

**1. Throttle before hashing.** Per-account and per-IP, via
`usp_Login_GetThrottleState`. The hash costs 316 ms deliberately, so an
unthrottled login route is a CPU-exhaustion lever whether or not any guess ever
lands. The per-IP limit is five times the per-account one: credential stuffing
puts one attempt against each of ten thousand accounts and never trips a
per-account counter, but lights up per-IP at once — and the multiplier exists
because a whole office shares one NAT address.

The procedure **excludes the app's own throttle rejections** from its counts.
Otherwise every retry extends the window over rows the throttle itself
generated, and the only escape is to send nothing for the full window — the
opposite of what a locked-out person does.

**2. Fetch the facts.** `usp_User_GetForLogin` returns the account, its current
hash, its algorithm, and whether it is locked out right now.

**3. Every rejection costs what a success costs.** Unknown address, locked out,
or inactive each run `burnVerify` — a real bcrypt comparison against a
throwaway hash. Without it an unknown address returns in about a millisecond
and a known one in 316, and that gap is a free account-enumeration oracle.

**4. Compare**, constant-time inside bcrypt.

**5. Re-hash if the stored cost is weaker than current.** Right now, and only
right now, we hold the plaintext. This is how a cost migration happens without
ever asking anyone to reset anything. Other sessions are *not* revoked — nothing
suspicious happened.

**6. A brand-new session token, always.** Carrying a pre-login token forward is
session fixation: plant a token in someone's browser, wait for them to sign in,
and hold one that is now authenticated.

Every failure returns the same sentence, whatever went wrong.

---

## Sessions

32 random bytes from the OS CSPRNG. **Only their SHA-256 reaches the database**,
so a stolen `auth.Sessions` cannot be used to resume anything.

The cookie is `HttpOnly; Secure; SameSite=Lax; Path=/`, eight hours, sliding.

- **HttpOnly** — JavaScript cannot read it, so an XSS bug cannot steal the
  session. The single most valuable flag here.
- **Lax, not Strict** — Strict drops the cookie on the first navigation in from
  an emailed link, which is how people arrive. Lax still refuses to send it on a
  cross-site POST, which is the case CSRF actually needs.

**Rows, not JWTs.** A signed token cannot be withdrawn, so "log out everywhere",
"we fired that driver" and "your password leaked" would all degrade to *wait it
out*. A row you can `DELETE` is the entire feature, and it costs one indexed
lookup per request.

`usp_Session_Validate` also re-checks `IsActive` on every request, so an account
disabled at 14:00 stops working at 14:00 rather than whenever its eight hours
happen to lapse.

Logging out **revokes server-side as well as clearing the cookie**. Clearing
alone would leave a working token for anyone who had copied it.

---

## Registration, verification and reset

```
?register=1  →  emailed link  →  ?verify=TOKEN
?signin=1 → "Forgot password?"  →  emailed link  →  ?reset=TOKEN
```

**There is no temporary password, and there will not be one.**

The 2023 ColdFusion original this project grew out of mailed one derived from
`getNumericDate(now())` — the request clock, computable by whoever triggered it —
and *overwrote the real password with it* before anyone proved they owned the
mailbox. Submitting a stranger's address locked them out and handed the sender
their account.

**The link is the credential**: 32 random bytes, stored only as a SHA-256,
single-use, expiring in an hour. **Nothing on the account changes until somebody
opens it.** That is the structural fix rather than a patch, and
`api/checks/register.check.js` asserts it directly — after `/api/forgot` the
stored hash is byte-identical and the old password still verifies.

**Enumeration is closed at every door.** Register and forgot return one
identical message whatever happened: taken, unknown, malformed, rate-limited.
Someone registering an address that already exists gets no hint from the form —
the **owner** is emailed instead, being the only party entitled to know and the
one who would want to.

`usp_User_Create` takes the password up front, so there is no password-less
account state: registration collects a password and the emailed link confirms
the **address**.

Reset validates the new password **before** spending the token. Otherwise a
rejected password burns the link, and after three attempts the rate limit locks
someone out of their own account recovery.

---

## Authorization

Authentication and authorization are separate. There are two ways to be
authenticated — this app's session cookie, or Static Web Apps' own
`x-ms-client-principal` — but **what you may do always comes from your
`auth.Users` row**. One place decides, so a role granted once applies to both
doors and revoking it closes both.

Roles are read **fresh on every request**, so a change takes effect on the next
request rather than the next sign-in.

| role | may |
|---|---|
| `none` | sign in; see the public board and nothing else |
| `driver` | their own settlement, nobody else's |
| `dispatcher` | add loads, read every settlement |
| `admin` | everything, plus approve accounts at `?view=admin` |

`IsActive` is a separate question from `Role`, deliberately:

| state | meaning |
|---|---|
| `IsActive = 0` | may not authenticate at all |
| `IsActive = 1`, `Role = 'none'` | signed in, awaiting approval |
| `IsActive = 1`, a role | approved |

Folding "awaiting approval" into `IsActive = 0` would make it indistinguishable
from "disabled", and those need different answers at the sign-in screen — one is
*we will get to you*, the other is *no*.

**`DriverCode` is what makes a pay statement private.** A driver reads their own
and gets **403** on anyone else's, compared against the code on their account
and never against the one in the URL — the URL is the question, not the answer.
403 rather than 404, deliberately: hiding it as "not found" would let a driver
map which codes exist by watching 403 turn into 404.

`CK_Users_DriverCode` requires that a driver has a code and everyone else does
not, so role and code always move in one statement.

**Approving accounts** (`?view=admin` → `/api/accounts`) has two guards:

- an admin cannot demote or deactivate **themselves**
- the **last active admin** cannot be removed by anyone

Recovering from either needs a DBA and a SQL prompt, and neither is ever what
somebody meant to do.

---

## What the public can see

The load board is public — that is the point of a load board. But *public* means
**current freight only**:

| | anonymous | signed in with a role |
|---|---|---|
| Available / Covered | yes | yes |
| Delivered history | **no** | yes |
| `driverCode`, `deliveredDate` | **nulled** | yes |

All 145 delivered rows carry a driver code and a date, so serving them
anonymously published which driver hauled which lane, on what date, for how
much — plus the full roster of twenty driver codes. Gating the settlement
routes while leaving that on the front page would have been gating the report
and publishing the data.

The fields are **nulled, not merely filtered**, because a Covered load could
gain a driver later and the status filter should not be the only thing between
a stranger and a name.

An account with `Role = 'none'` does not count as signed in for this. *Powerless
until approved* has to mean it here too, or registering becomes a way to read
the history.

---

## Configuration

All in the Static Web App's application settings — never in the repo.

| setting | what it is |
|---|---|
| `SQL_SERVER`, `SQL_DATABASE`, `SQL_USER`, `SQL_PASSWORD` | Millstream |
| `AUTH_PEPPER` | **shared with the ColdFusion app** |
| `SENDGRID_API_KEY` | Restricted Access, Mail Send only |
| `MAIL_FROM`, `MAIL_FROM_NAME`, `MAIL_REPLY_TO` | the verified single sender |
| `PUBLIC_BASE_URL` | origin for emailed links |

**`AUTH_PEPPER` is a shared secret between two applications. Rotating it
invalidates every password in both at once.** Change them together or not at
all.

`PUBLIC_BASE_URL` is set rather than derived from the request `Host` header,
because deriving a reset-link origin from a header is the classic shape of
password-reset poisoning.

**Mail currently shows "via sendgrid.net" in Gmail.** `MAIL_FROM` is a
`live.com` address and SendGrid signs as `sendgrid.net`, so DKIM does not align
with the From domain and DMARC cannot pass. It is delivered today; that is
Gmail being lenient, not a guarantee — and "via" is exactly the marker a
phishing-aware person is taught to look for. Authenticating a real domain
removes it, and should happen before a driver ever gets a reset link.

---

## Verifying it works

```
npm test                              # 24 unit tests, no database needed
node src/render.check.mjs             # 12 component states through react-dom/server
```

The rest need `SQL_*` and `AUTH_PEPPER` in the environment, create rows at
`@example.invalid`, and delete everything they make:

```
node api/checks/authStore.check.js    # every query against the real schema
node api/checks/session.check.js      # login / logout / me
node api/checks/register.check.js     # register / verify / forgot / reset
node api/checks/authz.check.js        # the authorization matrix
node api/checks/admin.check.js        # approving accounts
node api/checks/live.check.js         # over HTTPS, against the deployed site
node api/checks/cleanup-strays.js     # report; --delete to remove leftovers
```

**`live.check.js` is the important one.** Everything else calls handlers
directly, which tests the logic and skips the transport — routing, whether the
cookie survives the platform, whether the function even registered. It signs in
over HTTP and uses **the cookie the login route hands back**, because an earlier
version minted its own and so tested the lock without ever testing that anyone
is given a key.

---

## Platform behaviours that cost real outages

Three things behaved differently in Azure than on a laptop. All three passed
every local test.

**`cookies` in `@azure/functions` v4 must be objects.** A raw
`'lb_session=…; HttpOnly'` string is **silently discarded** — no error, no
warning. Login returned 200, wrote a session row, and sent no `Set-Cookie` at
all. Use `{ name, value, path, httpOnly, secure, sameSite, maxAge }`.

**`/api/admin/*` is unroutable.** The Functions host reserves `/admin` for its
own management API. A route of `admin/users` deploys cleanly and then 404s
forever. The approval screen is at `/api/accounts` for this reason.

**`"main": "src/functions/*.js"` is an interface.** Anything in that folder is
loaded as a function file. Three `*.check.js` scripts were once in it: they ran
`main()` against production in a restart loop, and one of them replaced
`app.http` to capture handlers, which silently swallowed `loads.js` and
`settlements.js`. Twelve minutes of downtime and 218 stray accounts. Checks now
live in `api/checks/` and every one is guarded by `require.main === module`.

The lesson common to all three: **nothing local loads the app the way the
platform does.** `src/render.check.mjs`, the glob simulation in the test run,
and `live.check.js` all exist because of this.

---

## Runbook

**Approve a new account.** `?view=admin`, set a role. Pending accounts sort to
the top. Changes take effect on the account's next request.

**The first admin** cannot be made through the UI — no admin exists to approve
them. Bootstrap by hand:

```sql
UPDATE auth.Users SET [Role] = 'admin', ModifiedUtc = SYSUTCDATETIME()
 WHERE EmailNormalized = N'<address, lower-cased>';
```

**Someone is locked out.** Lockout is time-based and clears itself; check
`Users.LockoutEndUtc`. To clear it early, set it to `NULL`.

**Rotate the pepper.** Do not, unless you are prepared to reset every password
in both applications. If you must: change `AUTH_PEPPER` and
`app-scaffold/config/env.json` together, then force a universal reset.

**Clean up after a check that failed partway.**

```
node api/checks/cleanup-strays.js            # report first, always
node api/checks/cleanup-strays.js --delete
```

It matches `claude-%@example.invalid` and `ZZ-` load ids only — never a date
range, because a cleanup that reasons about time is one clock skew away from
deleting a real account. It refuses outright if a `ZZ-` load turns out to be
referenced by a settlement.

**Nothing routes after a deploy.** Check the glob first — anything in
`api/src/functions/` is loaded as a function. Then recycle the workers, which a
deploy alone does not always do:

```
az staticwebapp appsettings set --name loadboard-wjm --resource-group loadboard-rg \
  --setting-names "DEPLOY_STAMP=$(date -Iseconds)"
```

---

## Known gaps

**The last-admin refusal is unexercised.** `admin.check.js` cannot drive the
count to one without demoting the real admin account, so that branch has been
read and never run. It is the only guard in the app taken on trust, and the
check says so in its output rather than leaving a green line that implies
otherwise.

**No MFA.** TOTP was deferred deliberately. It is the largest single
improvement still available.

**No passkeys.** Phishing-resistant and the genuine modern answer; they slot in
beside a password login rather than replacing it, so this is a migration rather
than a rewrite.

**SendGrid domain authentication.** See [Configuration](#configuration).

**Password history is stored but not enforced.** `auth.UserPasswords` keeps
retired rows, so "you cannot reuse your last five" is possible and not
implemented.
