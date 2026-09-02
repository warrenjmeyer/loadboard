const { app } = require('@azure/functions')
const store = require('../authStore')
const identity = require('../identity')
const { getPool, sql } = require('../db')

// ---------------------------------------------------------------------------
// GET  /api/admin/users              everyone, pending first
// POST /api/admin/users/{publicId}   set a role, or switch an account off
//
// Registration is open and every new account arrives with Role='none', able to
// sign in and do nothing. Until this existed the only way to approve anyone was
// an UPDATE at a SQL prompt, which meant the registration flow was a queue with
// no other end.
//
// Accounts are addressed by PublicId, never UserId. UserId is sequential, and
// telling the browser that account 7 exists tells it accounts 1 to 6 do too.
// ---------------------------------------------------------------------------

const ROLES = ['none', 'driver', 'dispatcher', 'admin']

function row(u) {
  return {
    publicId: u.PublicId,
    email: u.Email,
    displayName: u.DisplayName,
    role: u.Role,
    driverCode: u.DriverCode,
    driverName: u.first_name ? `${u.first_name} ${u.last_name}` : null,
    isActive: u.IsActive,
    isLockedOut: u.IsLockedOut,
    emailConfirmed: Boolean(u.EmailConfirmedUtc),
    createdUtc: u.CreatedUtc ? u.CreatedUtc.toISOString() : null,
    lastSeenUtc: u.LastSeenUtc ? u.LastSeenUtc.toISOString() : null,
  }
}

async function requireAdmin(request) {
  const user = await identity.currentUser(request)
  if (!user) return { error: identity.unauthorized('Sign in to continue.') }
  if (!identity.can(user, 'approveUsers')) {
    return { error: identity.forbidden('Only an administrator can manage accounts.') }
  }
  return { user }
}

async function handleList(request) {
  const gate = await requireAdmin(request)
  if (gate.error) return gate.error

  const users = await store.listUsers()

  return {
    jsonBody: {
      users: users.map(row),
      // The dropdown needs somewhere to get driver codes, and this is already
      // an admin-only response -- a second round trip to /api/drivers would
      // ask the same question of the same person.
      drivers: (await driverCodes()).map((d) => ({
        code: d.driver_code,
        name: `${d.first_name} ${d.last_name}`,
      })),
      // So the browser can grey out the controls that would fail anyway. The
      // server still refuses; this only stops someone being told "no" after
      // choosing.
      you: identity.publicUser(gate.user),
      activeAdmins: await store.countActiveAdmins(),
    },
    headers: { 'Cache-Control': 'no-store, private' },
  }
}

async function driverCodes() {
  const pool = await getPool()
  const result = await pool.request().query(
    `SELECT driver_code, first_name, last_name FROM dbo.Drivers ORDER BY last_name, first_name;`)
  return result.recordset
}

async function handleUpdate(request, context) {
  const gate = await requireAdmin(request)
  if (gate.error) return gate.error

  const publicId = request.params.publicId
  // A malformed id is a 400 rather than a lookup that cannot match. Passing a
  // non-GUID to a UniqueIdentifier parameter is a driver error, not a 404.
  if (!/^[0-9a-fA-F-]{36}$/.test(publicId || '')) {
    return { status: 400, jsonBody: { error: 'That is not a valid account id.' } }
  }

  let body
  try {
    body = await request.json()
  } catch {
    return { status: 400, jsonBody: { error: 'Expected a JSON body.' } }
  }

  const target = await store.findUserByPublicId(publicId)
  if (!target) return { status: 404, jsonBody: { error: 'No such account.' } }

  const ip = identity.clientIp(request)
  const isSelf = target.UserId === gate.user.userId

  // --- switching an account off ------------------------------------------
  if (typeof body.isActive === 'boolean') {
    // You cannot switch yourself off. Not because it is dangerous in itself,
    // but because it is never what someone means to do, and undoing it needs
    // another admin -- or a SQL prompt, if you were the only one.
    if (isSelf && !body.isActive) {
      return { status: 409, jsonBody: { error: 'You cannot deactivate your own account.' } }
    }

    if (!body.isActive && target.Role === 'admin' && (await store.countActiveAdmins()) <= 1) {
      return { status: 409, jsonBody: { error: 'That is the last active administrator. Promote someone else first.' } }
    }

    await store.setUserActive(target.UserId, body.isActive, 'AdminAction', ip)
    context.log(`${gate.user.email} set ${target.Email} isActive=${body.isActive}`)

    return { jsonBody: row(await reread(publicId)) }
  }

  // --- setting a role -----------------------------------------------------
  if (typeof body.role === 'string') {
    const role = body.role
    if (!ROLES.includes(role)) {
      return { status: 400, jsonBody: { error: `Role must be one of: ${ROLES.join(', ')}.` } }
    }

    // CK_Users_DriverCode enforces this in the database. Checking here turns a
    // constraint violation into a sentence naming the missing field.
    const driverCode = role === 'driver' ? String(body.driverCode || '').trim().toUpperCase() : null
    if (role === 'driver' && !driverCode) {
      return { status: 400, jsonBody: { error: 'A driver account needs a driver code.' } }
    }
    if (driverCode) {
      const known = (await driverCodes()).some((d) => d.driver_code.toUpperCase() === driverCode)
      // FK_Users_Driver would refuse it anyway, as a 500. This is the same
      // answer, phrased for a person.
      if (!known) return { status: 400, jsonBody: { error: `There is no driver with code ${driverCode}.` } }
    }

    // The two guards that keep the door from locking behind you.
    if (isSelf && role !== 'admin') {
      return { status: 409, jsonBody: { error: 'You cannot change your own role. Ask another administrator.' } }
    }
    if (target.Role === 'admin' && role !== 'admin' && (await store.countActiveAdmins()) <= 1) {
      return { status: 409, jsonBody: { error: 'That is the last active administrator. Promote someone else first.' } }
    }

    await store.setUserRole(target.UserId, role, driverCode, gate.user.email, ip)
    context.log(`${gate.user.email} set ${target.Email} role=${role}${driverCode ? ` (${driverCode})` : ''}`)

    return { jsonBody: row(await reread(publicId)) }
  }

  return { status: 400, jsonBody: { error: 'Send either a role or isActive.' } }
}

// findUserByPublicId returns the narrow shape the guards need; the response
// wants the wide one the list uses. Re-reading through listUsers' own
// projection means the row a caller gets back after a change is assembled by
// exactly the same code as the rows in the list -- two projections of one
// record are two things that can disagree.
async function reread(publicId) {
  const all = await store.listUsers()
  return all.find((u) => String(u.PublicId).toLowerCase() === String(publicId).toLowerCase()) || null
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

app.http('adminUsers', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'admin/users',
  handler: wrap('GET /api/admin/users', handleList),
})

app.http('adminUserUpdate', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'admin/users/{publicId}',
  handler: wrap('POST /api/admin/users/{publicId}', handleUpdate),
})

module.exports = { handleList, handleUpdate, ROLES }
