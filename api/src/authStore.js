const { getPool, sql } = require('./db')
const { hashToken, mintToken, PASSWORD_ALGORITHM, SESSION_MAX_AGE_S } = require('./auth')

// ---------------------------------------------------------------------------
// Thin wrappers over the auth stored procedures.
//
// The procedures are the shared API, not an implementation detail. The
// ColdFusion app at C:\Websites\app-scaffold calls exactly these, and every
// rule that matters -- lockout, sliding session expiry, single-use tokens,
// audit rows, which failures count toward a throttle -- lives inside them.
//
// This file previously wrote raw SQL against the tables. That worked, and it
// was wrong: two implementations of the same rules drift, and the drift is
// invisible until the day one app locks an account the other still lets in.
// Anything below that looks thin is thin on purpose. The logic is in the
// database, deliberately, so that both callers get the same answer.
//
// One consequence worth stating: @TokenHashHex is VARCHAR(64) lower-case hex
// on every one of these, even though the underlying columns are BINARY(32).
// The procs do `CONVERT(BINARY(32), @TokenHashHex, 2)` themselves. The
// procedure signature is the contract; the column type is not.
// ---------------------------------------------------------------------------

const TOKEN_TTL_MINUTES = 60

// CK_SecurityTokens_Purpose permits exactly these three. They are the schema's
// vocabulary, not ours. Registration uses EmailVerify rather than a purpose of
// its own, which is the honest name for it: the link proves the address.
const PURPOSE = {
  VERIFY: 'EmailVerify',
  RESET: 'PasswordReset',
  EMAIL_CHANGE: 'EmailChange',
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

// Returns the account plus its current password hash, algorithm, and whether
// it is locked out right now -- everything a login decision needs, in one
// call, computed server-side so the answer cannot drift between callers.
async function getUserForLogin(email) {
  const pool = await getPool()
  const result = await pool
    .request()
    .input('Email', sql.NVarChar(320), email)
    .execute('auth.usp_User_GetForLogin')

  return result.recordset[0] || null
}

// Role and DriverCode are not returned by the shared procedures: those were
// written before auth_01_roles.sql added the columns, and this app is not
// going to quietly rewrite a procedure the ColdFusion app depends on.
//
// So it is a separate read. Cheap -- a clustered-index seek on the primary key
// -- and honest about who owns what. If ColdFusion ever grows roles too, the
// right move is to fold these into usp_User_GetForLogin and delete this.
async function getAuthorization(userId) {
  const pool = await getPool()
  const result = await pool
    .request()
    .input('userId', sql.Int, userId)
    .query('SELECT [Role], DriverCode FROM auth.Users WHERE UserId = @userId;')

  return result.recordset[0] || null
}

// The account is created with its password in one transaction inside the
// procedure, so there is never a row that exists without one. Role defaults to
// 'none' -- registration is open and a new account can do nothing until an
// admin approves it.
async function createUser(email, passwordHash, displayName, ip) {
  const pool = await getPool()
  const result = await pool
    .request()
    .input('Email', sql.NVarChar(320), email)
    .input('PasswordHash', sql.VarChar(255), passwordHash)
    .input('Algorithm', sql.VarChar(32), PASSWORD_ALGORITHM)
    .input('DisplayName', sql.NVarChar(100), displayName || null)
    .input('IpAddress', sql.VarChar(45), ip || null)
    .execute('auth.usp_User_Create')

  return result.recordset[0]
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

// The procedure retires the old row, inserts the new one, writes the audit
// event and revokes other sessions -- all in one transaction. RevokeOtherSessions
// defaults on here for the reason it should: if the password changed because it
// leaked, leaving the attacker's session alive makes the change pointless.
//
// KeepSessionId exists so a signed-in user changing their own password is not
// logged out of the tab they are sitting in. Pass null when nobody should
// survive, which is the case for a reset from an emailed link.
async function setPassword(userId, passwordHash, { keepSessionId = null, ip = null, eventType = 'PasswordChanged' } = {}) {
  const pool = await getPool()
  await pool
    .request()
    .input('UserId', sql.Int, userId)
    .input('PasswordHash', sql.VarChar(255), passwordHash)
    .input('Algorithm', sql.VarChar(32), PASSWORD_ALGORITHM)
    .input('RevokeOtherSessions', sql.Bit, 1)
    .input('KeepSessionId', sql.BigInt, keepSessionId)
    .input('IpAddress', sql.VarChar(45), ip)
    .input('EventType', sql.VarChar(40), eventType)
    .execute('auth.usp_Password_Set')
}

async function confirmEmail(userId, ip) {
  const pool = await getPool()
  await pool
    .request()
    .input('UserId', sql.Int, userId)
    .input('IpAddress', sql.VarChar(45), ip || null)
    .execute('auth.usp_User_ConfirmEmail')
}

// ---------------------------------------------------------------------------
// Security tokens -- the emailed registration and reset links
// ---------------------------------------------------------------------------

// Returns the raw token, which exists only here and in the email that carries
// it. What reaches the database is its SHA-256 as hex, so a stolen table
// cannot complete a registration or a reset.
async function issueToken(userId, purpose, ip, lifetimeMinutes = TOKEN_TTL_MINUTES) {
  const { token, lookup } = mintToken()
  const pool = await getPool()

  await pool
    .request()
    .input('UserId', sql.Int, userId)
    .input('Purpose', sql.VarChar(30), purpose)
    .input('TokenHashHex', sql.VarChar(64), lookup)
    .input('LifetimeMinutes', sql.Int, lifetimeMinutes)
    .input('RequestIp', sql.VarChar(45), ip || null)
    .execute('auth.usp_Token_Issue')

  return token
}

// Spends the token and returns the account, or null.
//
// The procedure does the check and the spend in one UPDATE whose WHERE clause
// carries every condition -- right purpose, not consumed, not invalidated, not
// expired. Two requests arriving with the same token at the same instant are
// serialised by the row lock: one wins, one gets nothing. A SELECT followed by
// an UPDATE would read identically and let both through.
async function redeemToken(purpose, token) {
  const pool = await getPool()
  const result = await pool
    .request()
    .input('Purpose', sql.VarChar(30), purpose)
    .input('TokenHashHex', sql.VarChar(64), hashToken(token))
    .execute('auth.usp_Token_Redeem')

  return result.recordset[0] || null
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
async function createSession(userId, ip, userAgent, lifetimeMinutes = SESSION_MAX_AGE_S / 60) {
  const { token, lookup } = mintToken()
  const pool = await getPool()

  const result = await pool
    .request()
    .input('UserId', sql.Int, userId)
    .input('TokenHashHex', sql.VarChar(64), lookup)
    .input('LifetimeMinutes', sql.Int, lifetimeMinutes)
    .input('IpAddress', sql.VarChar(45), ip || null)
    // Truncated rather than rejected: a user agent longer than the column is a
    // curiosity, not a reason to refuse someone a session.
    .input('UserAgent', sql.NVarChar(400), userAgent ? userAgent.slice(0, 400) : null)
    .execute('auth.usp_Session_Create')

  return { token, session: result.recordset[0] }
}

// Called on every request that needs an identity. The procedure slides the
// expiry, touches LastSeenUtc, and refuses a session whose user has since been
// deactivated -- so an account disabled at 14:00 stops working at 14:00 rather
// than whenever its eight hours happen to run out.
async function validateSession(token, slideMinutes = SESSION_MAX_AGE_S / 60) {
  if (!token) return null

  const pool = await getPool()
  const result = await pool
    .request()
    .input('TokenHashHex', sql.VarChar(64), hashToken(token))
    .input('SlideMinutes', sql.Int, slideMinutes)
    .execute('auth.usp_Session_Validate')

  return result.recordset[0] || null
}

async function revokeSession(token, reason = 'Logout', ip = null) {
  if (!token) return
  const pool = await getPool()
  await pool
    .request()
    .input('TokenHashHex', sql.VarChar(64), hashToken(token))
    .input('Reason', sql.VarChar(40), reason)
    .input('IpAddress', sql.VarChar(45), ip)
    .execute('auth.usp_Session_Revoke')
}

async function revokeAllSessions(userId, reason = 'PasswordChanged', ip = null) {
  const pool = await getPool()
  await pool
    .request()
    .input('UserId', sql.Int, userId)
    .input('Reason', sql.VarChar(40), reason)
    .input('IpAddress', sql.VarChar(45), ip)
    .execute('auth.usp_Session_RevokeAllForUser')
}

// ---------------------------------------------------------------------------
// Throttling
//
// Ask BEFORE spending 316 ms on a bcrypt verify, not after. That ordering is
// the whole point: the hash is deliberately expensive, so an unthrottled login
// route is a CPU-exhaustion lever whether or not any guess ever lands.
//
// The procedure excludes the app's own throttle rejections from the counts,
// which matters more than it looks. Counting them would let every retry extend
// the window over rows the throttle itself generated, so the only escape would
// be to send nothing for the full window -- the opposite of what a locked-out
// person does. It is worse on the per-IP counter, which a whole office shares
// behind one NAT address.
// ---------------------------------------------------------------------------
async function getThrottleState(email, ip, windowMinutes = 15) {
  const pool = await getPool()
  const result = await pool
    .request()
    .input('Email', sql.NVarChar(320), email)
    .input('IpAddress', sql.VarChar(45), ip || '0.0.0.0')
    .input('WindowMinutes', sql.Int, windowMinutes)
    .execute('auth.usp_Login_GetThrottleState')

  return result.recordset[0]
}

// Records the attempt and applies a lockout when the limit is crossed. The
// email is passed through to the procedure, which decides what to keep.
async function recordLoginAttempt({
  email,
  ip,
  succeeded,
  userId = null,
  failureReason = null,
  windowMinutes = 15,
  failureLimit = 10,
  lockoutMinutes = 15,
}) {
  const pool = await getPool()
  const result = await pool
    .request()
    .input('Email', sql.NVarChar(320), email || null)
    .input('IpAddress', sql.VarChar(45), ip || '0.0.0.0')
    .input('WasSuccessful', sql.Bit, succeeded ? 1 : 0)
    .input('UserId', sql.Int, userId)
    .input('FailureReason', sql.VarChar(40), failureReason)
    .input('WindowMinutes', sql.Int, windowMinutes)
    .input('FailureLimit', sql.Int, failureLimit)
    .input('LockoutMinutes', sql.Int, lockoutMinutes)
    .execute('auth.usp_Login_RecordAttempt')

  return result.recordset[0] || null
}

// The general-purpose counter, for the things that are not logins: how many
// registration links an address has asked for, how many resets from one IP.
async function hitRateLimit(bucket, subjectKey, ip, { windowMinutes = 60, subjectLimit = 5, ipLimit = 20 } = {}) {
  const pool = await getPool()
  const result = await pool
    .request()
    .input('Bucket', sql.VarChar(30), bucket)
    .input('IpAddress', sql.VarChar(45), ip || '0.0.0.0')
    .input('SubjectKey', sql.NVarChar(320), subjectKey || null)
    .input('WindowMinutes', sql.Int, windowMinutes)
    .input('SubjectLimit', sql.Int, subjectLimit)
    .input('IpLimit', sql.Int, ipLimit)
    .execute('auth.usp_RateLimit_Hit')

  return result.recordset[0] || null
}


// ---------------------------------------------------------------------------
// Administration
//
// Role and DriverCode are columns this app added (auth_01_roles.sql), so they
// are the one place raw SQL is right: no shared procedure knows about them,
// and inventing one would mean editing an API the ColdFusion app depends on.
// IsActive is different -- usp_User_Deactivate and usp_User_Reactivate already
// exist and write the audit rows, so those are used rather than reimplemented.
// ---------------------------------------------------------------------------

// Everyone, newest first, with the pending ones surfaced by the caller. Small
// enough to send whole: this is a fleet, not a mailing list, and paging an
// approval queue nobody can see the end of is worse than a long page.
//
// PublicId is what leaves the server. UserId is a sequential key and telling
// the browser that account 7 exists tells it accounts 1 through 6 do too.
async function listUsers() {
  const pool = await getPool()
  const result = await pool.request().query(`
    SELECT u.PublicId, u.Email, u.DisplayName, u.[Role], u.DriverCode,
           u.IsActive, u.EmailConfirmedUtc, u.CreatedUtc, u.LockoutEndUtc,
           CAST(CASE WHEN u.LockoutEndUtc > SYSUTCDATETIME() THEN 1 ELSE 0 END AS BIT) AS IsLockedOut,
           d.first_name, d.last_name,
           (SELECT MAX(s.LastSeenUtc) FROM auth.Sessions s
             WHERE s.UserId = u.UserId AND s.RevokedUtc IS NULL) AS LastSeenUtc
    FROM auth.Users u
    LEFT JOIN dbo.Drivers d ON d.driver_code = u.DriverCode
    ORDER BY
      -- Waiting-for-approval first: that is the only row anyone opens this
      -- screen to act on.
      CASE WHEN u.[Role] = 'none' AND u.IsActive = 1 THEN 0 ELSE 1 END,
      u.CreatedUtc DESC;`)

  return result.recordset
}

async function findUserByPublicId(publicId) {
  const pool = await getPool()
  const result = await pool
    .request()
    .input('pid', sql.UniqueIdentifier, publicId)
    .query(`SELECT UserId, PublicId, Email, DisplayName, [Role], DriverCode, IsActive
            FROM auth.Users WHERE PublicId = @pid;`)

  return result.recordset[0] || null
}

// How many admins are left. The caller uses this to refuse the change that
// leaves nobody able to make changes -- an app with no admin needs a DBA and
// a SQL prompt to recover, which is not a state to reach through a dropdown.
async function countActiveAdmins() {
  const pool = await getPool()
  const result = await pool.request().query(
    `SELECT COUNT(*) AS n FROM auth.Users WHERE [Role] = 'admin' AND IsActive = 1;`)
  return result.recordset[0].n
}

// Role and DriverCode move together because CK_Users_DriverCode requires it:
// a driver must have a code, everyone else must not. Setting them in one
// statement is what keeps the row valid at every instant.
async function setUserRole(userId, role, driverCode, actorEmail, ip) {
  const pool = await getPool()
  await pool
    .request()
    .input('u', sql.Int, userId)
    .input('r', sql.VarChar(20), role)
    .input('d', sql.VarChar(20), role === 'driver' ? driverCode : null)
    .input('detail', sql.NVarChar(500), `role -> ${role}${role === 'driver' ? ` (${driverCode})` : ''} by ${actorEmail}`)
    .input('ip', sql.VarChar(45), ip || null)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;

        UPDATE auth.Users
           SET [Role] = @r, DriverCode = @d, ModifiedUtc = SYSUTCDATETIME()
         WHERE UserId = @u;

        -- Who changed whose access, and when. The one question an audit trail
        -- exists to answer, and the procedures cannot write it because they do
        -- not know these columns exist.
        INSERT INTO auth.AuthEvents (UserId, EventType, IpAddress, Detail)
        VALUES (@u, 'RoleChanged', @ip, @detail);

      COMMIT TRANSACTION;`)
}

async function setUserActive(userId, isActive, reason, ip) {
  const pool = await getPool()
  const request = pool.request().input('UserId', sql.Int, userId).input('IpAddress', sql.VarChar(45), ip || null)

  if (isActive) {
    await request.execute('auth.usp_User_Reactivate')
  } else {
    // Deactivating revokes their sessions inside the procedure, which is the
    // point: an account switched off at 14:00 stops working at 14:00.
    await request.input('Reason', sql.VarChar(40), reason || 'Deactivated').execute('auth.usp_User_Deactivate')
  }
}

module.exports = {
  getUserForLogin,
  getAuthorization,
  createUser,
  setPassword,
  confirmEmail,
  issueToken,
  redeemToken,
  createSession,
  validateSession,
  revokeSession,
  revokeAllSessions,
  getThrottleState,
  recordLoginAttempt,
  hitRateLimit,
  listUsers,
  findUserByPublicId,
  countActiveAdmins,
  setUserRole,
  setUserActive,
  PURPOSE,
  TOKEN_TTL_MINUTES,
}
