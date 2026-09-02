const { getPool, sql } = require('./db')
const { hashToken, mintToken, PASSWORD_ALGORITHM, SESSION_MAX_AGE_S } = require('./auth')

// ---------------------------------------------------------------------------
// Every read and write the login makes against the auth schema.
//
// It lives apart from the route handlers for the same reason auth.js lives
// apart from this: the routes decide what should happen, and these decide how
// to say it in SQL. Mixing them is how a query ends up written twice, slightly
// differently, and only one of the two checks whether the session was revoked.
//
// Two rules hold throughout.
//
// Every value is a parameter. Not one of these strings is built by
// concatenation -- the ColdFusion original this replaces had
// `WHERE userEmail = '#form.email#'`, and an email of  ' OR 1=1 --  was a
// login.
//
// The database enforces single-use, not this code. Where a token may be spent
// exactly once, the spending is an UPDATE whose WHERE clause contains the
// "not yet spent" condition. Two simultaneous requests both run it; SQL Server
// serialises them; the second updates zero rows and is refused. Reading first
// and then writing would let both pass.
// ---------------------------------------------------------------------------

// How long an emailed link is good for. Long enough to walk to a laptop, far
// too short to be worth attacking -- and single-use regardless.
const TOKEN_TTL_MINUTES = 60

// The only three values CK_SecurityTokens_Purpose permits. They are the
// schema's vocabulary, not ours, and inventing a fourth ('register', say) is a
// constraint violation surfacing as a 500 -- which is how this was found.
//
// Registration uses EmailVerify rather than a purpose of its own, and that is
// the honest name for it: the link proves the address, and setting the first
// password is what the person does once it has. EmailChange is unused so far.
const PURPOSE = {
  VERIFY: 'EmailVerify',
  RESET: 'PasswordReset',
  EMAIL_CHANGE: 'EmailChange',
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

// The current password comes back with the user, because every caller that
// wants one wants the other, and a LEFT JOIN here is one round trip instead of
// two. It is a LEFT join because a registered account has no password until it
// has followed the emailed link -- that row genuinely does not exist yet.
async function findUserByEmail(emailNormalized) {
  const pool = await getPool()
  const result = await pool
    .request()
    .input('email', sql.NVarChar(320), emailNormalized)
    .query(`
      SELECT u.UserId, u.PublicId, u.Email, u.DisplayName, u.IsActive,
             u.LockoutEndUtc, u.EmailConfirmedUtc, u.[Role], u.DriverCode,
             p.PasswordHash, p.Algorithm
      FROM auth.Users u
      LEFT JOIN auth.UserPasswords p
             ON p.UserId = u.UserId AND p.IsCurrent = 1
      WHERE u.EmailNormalized = @email;
    `)

  return result.recordset[0] || null
}

// IsActive = 1 and Role = 'none' (the column default): the account may sign in
// from the start, and can do nothing at all until an admin gives it a role.
// Those are two different questions and the schema keeps them apart -- see
// auth_01_roles.sql.
//
// EmailConfirmedUtc stays NULL. Following the emailed link is what proves the
// address, and setPassword is what records it.
async function createUser(email, emailNormalized, displayName) {
  const pool = await getPool()
  const result = await pool
    .request()
    .input('email', sql.NVarChar(320), email)
    .input('norm', sql.NVarChar(320), emailNormalized)
    .input('name', sql.NVarChar(100), displayName || null)
    .query(`
      INSERT INTO auth.Users (PublicId, Email, EmailNormalized, DisplayName,
                              IsActive, CreatedUtc, ModifiedUtc)
      OUTPUT inserted.UserId, inserted.PublicId
      VALUES (NEWID(), @email, @norm, @name, 1, SYSUTCDATETIME(), SYSUTCDATETIME());
    `)

  return result.recordset[0]
}

// ---------------------------------------------------------------------------
// Passwords
//
// UserPasswords is a history, not a single value: the current one carries
// IsCurrent = 1 and the rest are retired. That is what makes "you cannot reuse
// your last five" possible later, and it means setting a password is two
// writes that must both happen or neither.
//
// Hence the explicit transaction. Without it, a failure between the UPDATE and
// the INSERT leaves an account with no current password -- which the LEFT JOIN
// above reports as "never set one", and the person can no longer log in.
//
// The order is also forced, not merely tidy. UX_UserPasswords_OneCurrent is a
// UNIQUE index on UserId filtered to IsCurrent = 1, so the database itself
// guarantees at most one current password per account -- and inserting the new
// row before retiring the old one violates it. Retire first, then insert.
//
// CK_UserPasswords_Retired pairs the two columns the other way: IsCurrent = 0
// requires a RetiredUtc, and IsCurrent = 1 requires none. So a retired row
// must be given its timestamp in the same statement that retires it.
// ---------------------------------------------------------------------------
async function setPassword(userId, passwordHash, algorithm = PASSWORD_ALGORITHM) {
  const pool = await getPool()
  await pool
    .request()
    .input('userId', sql.Int, userId)
    .input('hash', sql.VarChar(255), passwordHash)
    .input('alg', sql.VarChar(32), algorithm)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;

        UPDATE auth.UserPasswords
           SET IsCurrent = 0, RetiredUtc = SYSUTCDATETIME()
         WHERE UserId = @userId AND IsCurrent = 1;

        INSERT INTO auth.UserPasswords (UserId, PasswordHash, Algorithm, IsCurrent, CreatedUtc)
        VALUES (@userId, @hash, @alg, 1, SYSUTCDATETIME());

        -- Setting a password through an emailed link also proves the address,
        -- so confirm it if it was not already. COALESCE keeps the FIRST
        -- confirmation date rather than moving it on every password change.
        UPDATE auth.Users
           SET ModifiedUtc = SYSUTCDATETIME(),
               EmailConfirmedUtc = COALESCE(EmailConfirmedUtc, SYSUTCDATETIME())
         WHERE UserId = @userId;

        -- Every existing session dies. If the password was changed because it
        -- leaked, leaving the attacker's session alive would make the change
        -- pointless -- and this is the case a JWT cannot handle at all.
        UPDATE auth.Sessions
           SET RevokedUtc = SYSUTCDATETIME(), RevokedReason = 'password-changed'
         WHERE UserId = @userId AND RevokedUtc IS NULL;

      COMMIT TRANSACTION;
    `)
}

// ---------------------------------------------------------------------------
// Security tokens -- the emailed registration and reset links
// ---------------------------------------------------------------------------

// Returns the raw token, which exists only in the returned string and in the
// email that carries it. What is stored is its SHA-256.
//
// Any earlier unspent link for the same purpose is invalidated first, so
// asking again really does replace the last one. Otherwise every request would
// leave another working key lying in an inbox.
async function issueToken(userId, purpose, requestIp) {
  const { token, lookup } = mintToken()
  const pool = await getPool()

  await pool
    .request()
    .input('userId', sql.Int, userId)
    .input('purpose', sql.VarChar(30), purpose)
    .input('hash', sql.Binary(32), lookup)
    .input('ttl', sql.Int, TOKEN_TTL_MINUTES)
    .input('ip', sql.VarChar(45), requestIp || null)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;

        UPDATE auth.SecurityTokens
           SET InvalidatedUtc = SYSUTCDATETIME()
         WHERE UserId = @userId AND Purpose = @purpose
           AND ConsumedUtc IS NULL AND InvalidatedUtc IS NULL;

        INSERT INTO auth.SecurityTokens
            (UserId, Purpose, TokenHash, CreatedUtc, ExpiresUtc, RequestIp)
        VALUES (@userId, @purpose, @hash, SYSUTCDATETIME(),
                DATEADD(minute, @ttl, SYSUTCDATETIME()), @ip);

      COMMIT TRANSACTION;
    `)

  return token
}

// Spends the token and says whose it was, or null.
//
// One statement on purpose. The conditions that make a token usable -- right
// purpose, not consumed, not invalidated, not expired -- are in the WHERE
// clause of the UPDATE that consumes it, so the check and the spend cannot be
// separated. Two requests arriving with the same token at the same instant are
// serialised by the row lock: the first updates one row, the second updates
// none and gets null.
//
// A SELECT followed by an UPDATE would look identical and let both through.
async function consumeToken(purpose, token) {
  const pool = await getPool()
  const result = await pool
    .request()
    .input('purpose', sql.VarChar(30), purpose)
    .input('hash', sql.Binary(32), hashToken(token))
    .query(`
      UPDATE auth.SecurityTokens
         SET ConsumedUtc = SYSUTCDATETIME()
      OUTPUT inserted.UserId
       WHERE TokenHash = @hash
         AND Purpose = @purpose
         AND ConsumedUtc IS NULL
         AND InvalidatedUtc IS NULL
         AND ExpiresUtc > SYSUTCDATETIME();
    `)

  return result.recordset.length ? result.recordset[0].UserId : null
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
async function createSession(userId, ip, userAgent, maxAgeSeconds = SESSION_MAX_AGE_S) {
  const { token, lookup } = mintToken()
  const pool = await getPool()

  await pool
    .request()
    .input('userId', sql.Int, userId)
    .input('hash', sql.Binary(32), lookup)
    .input('seconds', sql.Int, maxAgeSeconds)
    .input('ip', sql.VarChar(45), ip || null)
    // Truncated rather than rejected: a user agent longer than the column is a
    // curiosity, not a reason to refuse someone a session.
    .input('ua', sql.NVarChar(400), userAgent ? userAgent.slice(0, 400) : null)
    .query(`
      INSERT INTO auth.Sessions (UserId, TokenHash, IssuedUtc, ExpiresUtc,
                                 LastSeenUtc, IpAddress, UserAgent)
      VALUES (@userId, @hash, SYSUTCDATETIME(),
              DATEADD(second, @seconds, SYSUTCDATETIME()),
              SYSUTCDATETIME(), @ip, @ua);
    `)

  return token
}

// Who this cookie belongs to, or null. Called on every request that needs an
// identity, so it is one round trip: the touch and the lookup travel together.
//
// IsActive is checked HERE and not only at login. An account disabled at 14:00
// must stop working at 14:00, not whenever its eight-hour session happens to
// run out.
async function resolveSession(token) {
  if (!token) return null

  const pool = await getPool()
  const result = await pool
    .request()
    .input('hash', sql.Binary(32), hashToken(token))
    .query(`
      DECLARE @hit TABLE (UserId INT);

      UPDATE auth.Sessions
         SET LastSeenUtc = SYSUTCDATETIME()
      OUTPUT inserted.UserId INTO @hit
       WHERE TokenHash = @hash
         AND RevokedUtc IS NULL
         AND ExpiresUtc > SYSUTCDATETIME();

      SELECT u.UserId, u.PublicId, u.Email, u.DisplayName, u.[Role], u.DriverCode
      FROM @hit h
      JOIN auth.Users u ON u.UserId = h.UserId
      WHERE u.IsActive = 1;
    `)

  return result.recordset[0] || null
}

// Revoked, not deleted, so "signed out at 14:02" survives as an answer.
async function revokeSession(token, reason = 'signed-out') {
  if (!token) return
  const pool = await getPool()
  await pool
    .request()
    .input('hash', sql.Binary(32), hashToken(token))
    .input('reason', sql.VarChar(40), reason)
    .query(`
      UPDATE auth.Sessions
         SET RevokedUtc = SYSUTCDATETIME(), RevokedReason = @reason
       WHERE TokenHash = @hash AND RevokedUtc IS NULL;
    `)
}

// ---------------------------------------------------------------------------
// Attempts, rate limits and the audit trail
// ---------------------------------------------------------------------------

// EmailNormalized is recorded only when it matched a real account. A table of
// every address anyone ever typed at the login form is a list worth stealing,
// and it would answer "does this person have an account here" to anyone who
// later reads it.
async function recordLoginAttempt({ userId, emailNormalized, ip, succeeded, failureReason }) {
  const pool = await getPool()
  await pool
    .request()
    .input('userId', sql.Int, userId || null)
    .input('email', sql.NVarChar(320), userId ? emailNormalized : null)
    .input('ip', sql.VarChar(45), ip || '0.0.0.0')
    .input('ok', sql.Bit, succeeded ? 1 : 0)
    .input('reason', sql.VarChar(40), failureReason || null)
    .query(`
      INSERT INTO auth.LoginAttempts
          (EmailNormalized, UserId, IpAddress, AttemptedUtc, WasSuccessful, FailureReason)
      VALUES (@email, @userId, @ip, SYSUTCDATETIME(), @ok, @reason);
    `)
}

// Two counts from one round trip, because both matter and for different
// reasons: by account, guessing one person's password; by address, guessing
// everyone's -- and, just as importantly, exhausting memory. Each scrypt hash
// costs about 64 MB against a Function's 1.5 GB, so an unthrottled /api/login
// is a denial-of-service lever whether or not any guess ever lands.
async function recentFailures({ userId, ip, minutes = 15 }) {
  const pool = await getPool()
  const result = await pool
    .request()
    .input('userId', sql.Int, userId || null)
    .input('ip', sql.VarChar(45), ip || '0.0.0.0')
    .input('minutes', sql.Int, minutes)
    .query(`
      DECLARE @since DATETIME2(7) = DATEADD(minute, -@minutes, SYSUTCDATETIME());

      SELECT
        (SELECT COUNT(*) FROM auth.LoginAttempts
          WHERE UserId = @userId AND WasSuccessful = 0 AND AttemptedUtc >= @since) AS byUser,
        (SELECT COUNT(*) FROM auth.LoginAttempts
          WHERE IpAddress = @ip AND WasSuccessful = 0 AND AttemptedUtc >= @since) AS byIp;
    `)

  const row = result.recordset[0]
  return { byUser: row.byUser, byIp: row.byIp }
}

// A general-purpose counter for the things that are not logins -- how many
// registration links this address has asked for, how many resets from this IP.
// Recorded and counted separately from LoginAttempts because the questions
// have different windows and different thresholds.
async function hitRateLimit(bucket, subjectKey, ip) {
  const pool = await getPool()
  await pool
    .request()
    .input('bucket', sql.VarChar(30), bucket)
    .input('subject', sql.NVarChar(320), subjectKey || null)
    .input('ip', sql.VarChar(45), ip || '0.0.0.0')
    .query(`
      INSERT INTO auth.RateLimits (Bucket, SubjectKey, IpAddress, OccurredUtc)
      VALUES (@bucket, @subject, @ip, SYSUTCDATETIME());
    `)
}

async function rateLimitCount(bucket, subjectKey, ip, minutes = 60) {
  const pool = await getPool()
  const result = await pool
    .request()
    .input('bucket', sql.VarChar(30), bucket)
    .input('subject', sql.NVarChar(320), subjectKey || null)
    .input('ip', sql.VarChar(45), ip || '0.0.0.0')
    .input('minutes', sql.Int, minutes)
    .query(`
      DECLARE @since DATETIME2(7) = DATEADD(minute, -@minutes, SYSUTCDATETIME());

      SELECT
        (SELECT COUNT(*) FROM auth.RateLimits
          WHERE Bucket = @bucket AND SubjectKey = @subject AND OccurredUtc >= @since) AS bySubject,
        (SELECT COUNT(*) FROM auth.RateLimits
          WHERE Bucket = @bucket AND IpAddress = @ip AND OccurredUtc >= @since) AS byIp;
    `)

  const row = result.recordset[0]
  return { bySubject: row.bySubject, byIp: row.byIp }
}

// The audit trail. Deliberately never fails a request: if writing history
// breaks, the thing that made the history should still have happened.
async function logEvent(userId, eventType, ip, detail) {
  try {
    const pool = await getPool()
    await pool
      .request()
      .input('userId', sql.Int, userId || null)
      .input('type', sql.VarChar(40), eventType)
      .input('ip', sql.VarChar(45), ip || null)
      .input('detail', sql.NVarChar(500), detail ? String(detail).slice(0, 500) : null)
      .query(`
        INSERT INTO auth.AuthEvents (UserId, EventType, OccurredUtc, IpAddress, Detail)
        VALUES (@userId, @type, SYSUTCDATETIME(), @ip, @detail);
      `)
  } catch {
    // Swallowed on purpose. The caller has already done the real work.
  }
}

module.exports = {
  findUserByEmail,
  createUser,
  setPassword,
  issueToken,
  consumeToken,
  createSession,
  resolveSession,
  revokeSession,
  recordLoginAttempt,
  recentFailures,
  hitRateLimit,
  rateLimitCount,
  logEvent,
  PURPOSE,
  TOKEN_TTL_MINUTES,
}
