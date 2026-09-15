const { readSessionToken, normaliseEmail } = require('./auth')
const { validateSession, getAuthorization, getUserForLogin } = require('./authStore')

// ---------------------------------------------------------------------------
// Who is making this request, and what may they do.
//
// There are two ways to be authenticated here and they are not
// interchangeable:
//
//   the app session   a cookie this app issued, backed by auth.Sessions.
//                     Drivers and anyone else with an account in Millstream.
//
//   the platform      Static Web Apps' own login, arriving as the header
//                     x-ms-client-principal. Staff signing in with GitHub,
//                     which is what gates POST /api/loads today.
//
// Authentication differs. AUTHORIZATION DOES NOT: whichever way someone got
// here, what they may do comes from their row in auth.Users. One place decides,
// so a role granted once applies to both doors -- and revoking it closes both.
// ---------------------------------------------------------------------------

// Static Web Apps injects this header and strips any a client sends, so it
// cannot be forged from outside. That is true *behind SWA*; run the Functions
// host directly and nothing sets it, which is why the sensitive routes also
// carry a route rule in staticwebapp.config.json.
function readPlatformPrincipal(request) {
  const header = request.headers.get('x-ms-client-principal')
  if (!header) return null
  try {
    const parsed = JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
    return parsed && parsed.userId ? parsed : null
  } catch {
    return null
  }
}

// The caller's address, for throttling and for the audit trail.
//
// x-forwarded-for is a list; the client-controlled entries are appended on the
// left, so the LAST entry is the one added by the nearest trusted proxy. Taking
// the first would let anyone set their own apparent IP by sending the header
// themselves -- and then rate limiting counts a value the attacker chooses.
function clientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const parts = forwarded.split(',').map((s) => s.trim()).filter(Boolean)
    if (parts.length) {
      // Azure appends a port to the forwarded address; strip it, and leave
      // IPv6 (which contains colons of its own) alone.
      const last = parts[parts.length - 1]
      const withoutPort = /^\d+\.\d+\.\d+\.\d+:\d+$/.test(last) ? last.split(':')[0] : last
      return withoutPort.slice(0, 45)
    }
  }
  return '0.0.0.0'
}

// Returns null when nobody is signed in. Never throws: an unreadable cookie is
// an anonymous request, not a server error.
async function currentUser(request) {
  const token = readSessionToken(request)

  if (token) {
    const session = await validateSession(token)
    if (session) {
      const authz = await getAuthorization(session.UserId)
      return {
        via: 'session',
        userId: session.UserId,
        sessionId: session.SessionId,
        email: session.Email || null,
        displayName: session.DisplayName || null,
        role: authz ? authz.Role : 'none',
        driverCode: authz ? authz.DriverCode : null,
      }
    }
  }

  const principal = readPlatformPrincipal(request)
  if (!principal) return null

  // Map the platform login onto an account, so authorization has one source.
  //
  // userDetails is an email for Entra ID and a USERNAME for GitHub, so this
  // only resolves when it happens to look like an address. A GitHub user whose
  // username is not their email gets no role -- correctly, because we cannot
  // prove which account they are. Fixing that properly means reading the email
  // claim, which requires configuring the provider to release it.
  const email = normaliseEmail(principal.userDetails)
  if (email) {
    const account = await getUserForLogin(email)
    if (account && account.IsActive) {
      const authz = await getAuthorization(account.UserId)
      return {
        via: 'platform',
        userId: account.UserId,
        sessionId: null,
        email: account.Email,
        displayName: account.DisplayName,
        role: authz ? authz.Role : 'none',
        driverCode: authz ? authz.DriverCode : null,
      }
    }
  }

  // Authenticated by the platform but matching no account. They are somebody,
  // but nobody we know, so they hold no role.
  return {
    via: 'platform',
    userId: null,
    sessionId: null,
    email: principal.userDetails || null,
    displayName: principal.userDetails || null,
    role: 'none',
    driverCode: null,
  }
}

// What each role may do. Listed once, here, rather than as scattered
// comparisons -- "can this person add a load" should have exactly one answer.
const CAN = {
  addLoad: new Set(['dispatcher', 'admin']),
  // Details, assignment, and any status move. A driver's own forward moves
  // (picked up, delivered) are not a role permission but a relationship to
  // the load, and loadRules.allowedTransitions decides those.
  editLoad: new Set(['dispatcher', 'admin']),
  manageFleet: new Set(['dispatcher', 'admin']),
  manageCustomers: new Set(['dispatcher', 'admin']),
  // Payroll is not dispatch. Generating a settlement is a money decision.
  runPayroll: new Set(['admin']),
  // Billing likewise: generating, paying and voiding invoices is admin work.
  // Reading them is dispatch's too -- "has this customer paid" is the
  // question behind whether to take their next load.
  runBilling: new Set(['admin']),
  viewInvoices: new Set(['dispatcher', 'admin']),
  approveUsers: new Set(['admin']),
  viewAllSettlements: new Set(['dispatcher', 'admin']),
  // Every driver's hours-of-service clocks at once. One driver's own hours
  // are not a role permission but a relationship, and canViewDriver decides.
  viewAllHours: new Set(['dispatcher', 'admin']),
  // Ask HERE what time this load gets there. Narrower than the other reads
  // for a reason that is not about privacy: every ETA is a metered
  // transaction on somebody's bill. A driver still gets one for their own
  // load -- that is a relationship, not a role, and functions/eta.js
  // decides it the way hours does.
  requestEta: new Set(['dispatcher', 'admin']),
}

function can(user, action) {
  if (!user) return false
  const allowed = CAN[action]
  return allowed ? allowed.has(user.role) : false
}

// May this user see this driver's settlement? A driver sees their own and
// nobody else's; dispatchers and admins see everyone's.
//
// Compares against the DriverCode on the account, never against anything in
// the URL -- the URL is the question, not the answer.
function canViewDriver(user, driverCode) {
  if (!user) return false
  if (can(user, 'viewAllSettlements')) return true
  if (user.role !== 'driver' || !user.driverCode) return false
  return user.driverCode.toUpperCase() === String(driverCode || '').toUpperCase()
}

// The shapes routes return. 401 means "we do not know who you are", 403 means
// "we do and you may not" -- distinct on purpose, because the first is fixed by
// signing in and the second never is.
function unauthorized(message = 'Sign in to continue.') {
  return { status: 401, jsonBody: { error: message } }
}

function forbidden(message = 'Your account does not have access to that.') {
  return { status: 403, jsonBody: { error: message } }
}

// What the browser is allowed to know about the signed-in user. UserId is
// deliberately absent -- PublicId exists precisely so a sequential internal
// key never leaves the server.
function publicUser(user) {
  if (!user) return null
  return {
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    driverCode: user.driverCode,
    via: user.via,
    pendingApproval: user.role === 'none',
  }
}

module.exports = {
  currentUser,
  readPlatformPrincipal,
  clientIp,
  can,
  canViewDriver,
  unauthorized,
  forbidden,
  publicUser,
  CAN,
}
