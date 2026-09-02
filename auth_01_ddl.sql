-- auth_01_ddl.sql
-- The tables behind the login. Requires CREATE TABLE (and CREATE SCHEMA the
-- first time) -- hand this to a DBA / db_owner if your login is denied.
--
--  !! RUN auth_00_inspect.sql FIRST. !!
--
-- Every CREATE below is guarded, so re-running this is safe and an existing
-- object is left alone. But "left alone" is the failure worth watching for: if
-- the auth schema already holds a Users table of a different shape, this
-- script quietly does nothing and the API then queries columns that are not
-- there. The PRINT lines say which branch was taken. If any of them report
-- "already exists", stop and compare before going further.
--
-- Nothing here migrates the ColdFusion credentials. The original login
-- accepted plaintext as well as unsalted SHA-512, so any password in that
-- system may already be known; carrying one across would carry the problem
-- with it. Everyone sets a new password through the emailed link.

SET NOCOUNT ON;
GO

------------------------------------------------------------------------------
-- The schema itself.
------------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'auth')
BEGIN
    EXEC(N'CREATE SCHEMA auth');
    PRINT 'CREATED schema auth';
END
ELSE
    PRINT 'schema auth already exists';
GO


------------------------------------------------------------------------------
-- auth.Users
--
-- Registration is open, and a new account can do nothing until it is
-- approved. That is two facts, not one, so they are two columns:
--
--   status  -- may this account log in at all?      pending -> active
--   role    -- once in, what may it see and do?     none -> driver/dispatcher/admin
--
-- Collapsing them into a single "is_approved" bit reads fine until you need to
-- suspend someone without forgetting they were a dispatcher.
--
-- password_hash is NULLABLE on purpose. A row exists from the moment someone
-- registers, but they have no password until they open the emailed link and
-- choose one -- and that gap is exactly what stops a registration request from
-- disturbing an account that already exists.
------------------------------------------------------------------------------
IF OBJECT_ID(N'auth.Users', N'U') IS NULL
BEGIN
    CREATE TABLE auth.Users (
        user_id             INT            IDENTITY(1,1) NOT NULL,

        -- 254 is the longest deliverable address. Stored lower-cased by the
        -- API so one person cannot hold two accounts differing only in case.
        email               NVARCHAR(254)  NOT NULL,

        -- scrypt$N$r$p$salt$hash -- ASCII, about 86 characters at today's
        -- parameters. VARCHAR(200) leaves room to raise the cost later without
        -- a schema change.
        password_hash       VARCHAR(200)   NULL,

        status              VARCHAR(20)    NOT NULL
            CONSTRAINT DF_Users_status DEFAULT 'pending',
        [role]              VARCHAR(20)    NOT NULL
            CONSTRAINT DF_Users_role   DEFAULT 'none',

        -- Which driver this login IS, when it is a driver. This is the column
        -- that makes a pay statement private: the API compares it to the code
        -- in the URL, so a driver sees their own settlement and no one else's.
        driver_code         VARCHAR(20)    NULL,

        -- UTC everywhere. SYSUTCDATETIME(), not GETDATE(): the server's local
        -- zone is an Azure region's business, and a session that expires an
        -- hour early twice a year is a bug nobody enjoys finding.
        created_at          DATETIME2(0)   NOT NULL
            CONSTRAINT DF_Users_created DEFAULT SYSUTCDATETIME(),
        password_changed_at DATETIME2(0)   NULL,
        last_login_at       DATETIME2(0)   NULL,

        CONSTRAINT PK_Users PRIMARY KEY (user_id),

        -- The real identity. A unique index rather than a bare constraint so
        -- the lookup on every login uses it.
        CONSTRAINT UQ_Users_email UNIQUE (email),

        CONSTRAINT CK_Users_status CHECK (status IN ('pending', 'active', 'disabled')),
        CONSTRAINT CK_Users_role   CHECK ([role] IN ('none', 'driver', 'dispatcher', 'admin')),

        -- An account that can log in must have something to log in with.
        -- Without this, a bug that activated a row before its password was set
        -- would leave an account whose password is NULL -- and NULL comparisons
        -- are exactly the kind of thing that accidentally succeeds.
        CONSTRAINT CK_Users_active_has_password
            CHECK (status <> 'active' OR password_hash IS NOT NULL),

        -- A driver login has to say which driver. A dispatcher must not.
        CONSTRAINT CK_Users_driver_code
            CHECK (([role] = 'driver' AND driver_code IS NOT NULL)
                OR ([role] <> 'driver' AND driver_code IS NULL)),

        CONSTRAINT FK_Users_driver FOREIGN KEY (driver_code)
            REFERENCES dbo.Drivers (driver_code)
    );
    PRINT 'CREATED auth.Users';
END
ELSE
    PRINT 'auth.Users already exists -- STOP and compare its columns';
GO


------------------------------------------------------------------------------
-- auth.Tokens -- the emailed links.
--
-- One row per link sent. What is stored is the SHA-256 of the token, never the
-- token: if this table leaks, the rows in it cannot complete a registration or
-- a reset. The token itself exists only in the email.
--
-- No password is ever emailed. The 2023 original mailed a "temporary password"
-- derived from the request clock AND overwrote the real password with it, so
-- submitting a stranger's address locked them out and handed the sender an
-- account. Nothing here touches auth.Users.password_hash until someone opens
-- the link and sets one.
------------------------------------------------------------------------------
IF OBJECT_ID(N'auth.Tokens', N'U') IS NULL
BEGIN
    CREATE TABLE auth.Tokens (
        token_id    INT           IDENTITY(1,1) NOT NULL,
        user_id     INT           NOT NULL,

        purpose     VARCHAR(20)   NOT NULL,

        -- SHA-256 as hex is exactly 64 characters, always. CHAR, not VARCHAR:
        -- fixed width, and no chance of a trailing space making a lookup miss.
        token_hash  CHAR(64)      NOT NULL,

        -- Short. An hour is long enough to walk to a laptop and far too short
        -- to be worth attacking, and the link is single-use regardless.
        expires_at  DATETIME2(0)  NOT NULL,

        -- Set the moment the link is used. Non-NULL means spent: a link
        -- forwarded, cached by a mail scanner, or pulled from a browser
        -- history is already dead.
        used_at     DATETIME2(0)  NULL,

        created_at  DATETIME2(0)  NOT NULL
            CONSTRAINT DF_Tokens_created DEFAULT SYSUTCDATETIME(),

        CONSTRAINT PK_Tokens PRIMARY KEY (token_id),
        CONSTRAINT UQ_Tokens_hash UNIQUE (token_hash),
        CONSTRAINT CK_Tokens_purpose CHECK (purpose IN ('register', 'reset')),

        -- Delete a user, delete their outstanding links. There is no reason a
        -- token should outlive the account it would have unlocked.
        CONSTRAINT FK_Tokens_user FOREIGN KEY (user_id)
            REFERENCES auth.Users (user_id) ON DELETE CASCADE
    );

    -- The expiry sweep and the "invalidate this user's older links" step both
    -- filter on user + purpose.
    CREATE INDEX IX_Tokens_user ON auth.Tokens (user_id, purpose) INCLUDE (used_at, expires_at);

    PRINT 'CREATED auth.Tokens';
END
ELSE
    PRINT 'auth.Tokens already exists -- STOP and compare its columns';
GO


------------------------------------------------------------------------------
-- auth.Sessions
--
-- Opaque tokens in a table, not JWTs. A JWT cannot be withdrawn: a signed
-- token stays valid until it expires no matter what happens to the account, so
-- "log out everywhere", "we fired that driver" and "change your password
-- because it leaked" all become "wait it out". A row you can DELETE is the
-- entire feature, and it costs one indexed lookup per request.
--
-- Same rule as Tokens: the hash is stored, the value lives only in the
-- browser's cookie.
------------------------------------------------------------------------------
IF OBJECT_ID(N'auth.Sessions', N'U') IS NULL
BEGIN
    CREATE TABLE auth.Sessions (
        session_id   INT           IDENTITY(1,1) NOT NULL,
        user_id      INT           NOT NULL,
        token_hash   CHAR(64)      NOT NULL,

        created_at   DATETIME2(0)  NOT NULL
            CONSTRAINT DF_Sessions_created DEFAULT SYSUTCDATETIME(),
        expires_at   DATETIME2(0)  NOT NULL,

        -- Touched as the session is used, so an idle timeout is possible
        -- separately from the absolute one above.
        last_seen_at DATETIME2(0)  NOT NULL
            CONSTRAINT DF_Sessions_seen DEFAULT SYSUTCDATETIME(),

        -- Set instead of deleting, so "signed out at 14:02" survives as an
        -- answer. The sweep clears these out later.
        revoked_at   DATETIME2(0)  NULL,

        CONSTRAINT PK_Sessions PRIMARY KEY (session_id),
        CONSTRAINT UQ_Sessions_hash UNIQUE (token_hash),
        CONSTRAINT FK_Sessions_user FOREIGN KEY (user_id)
            REFERENCES auth.Users (user_id) ON DELETE CASCADE
    );

    -- "Revoke every session for this user" -- a password change, an account
    -- disabled, a sign-out-everywhere.
    CREATE INDEX IX_Sessions_user ON auth.Sessions (user_id) INCLUDE (revoked_at, expires_at);

    PRINT 'CREATED auth.Sessions';
END
ELSE
    PRINT 'auth.Sessions already exists -- STOP and compare its columns';
GO


------------------------------------------------------------------------------
-- auth.LoginAttempts -- what rate limiting counts.
--
-- Throttling, not locking. A hard lockout after N failures hands anyone a way
-- to lock out any user whose email they can guess, which turns a defence into
-- a denial of service. Counting recent failures and slowing down (or demanding
-- more) does the job without that.
--
-- This also protects availability rather than only accounts: each password
-- hash deliberately costs about 64 MB, and a Consumption Function has 1.5 GB,
-- so roughly twenty simultaneous logins exhaust it. Unthrottled, /api/login is
-- a memory-exhaustion lever. Counting by IP is what stops that; counting by
-- email is what stops guessing.
--
-- No email is written for an address that does not exist -- see the API. A
-- table of every address anyone ever typed is a list worth stealing.
------------------------------------------------------------------------------
IF OBJECT_ID(N'auth.LoginAttempts', N'U') IS NULL
BEGIN
    CREATE TABLE auth.LoginAttempts (
        attempt_id   BIGINT        IDENTITY(1,1) NOT NULL,

        -- NULL when the address was not a known account.
        user_id      INT           NULL,

        -- 45 characters is the longest IPv6 text form, including a mapped
        -- IPv4 tail. Taken from the platform's forwarded-for header.
        ip           VARCHAR(45)   NULL,

        attempted_at DATETIME2(0)  NOT NULL
            CONSTRAINT DF_Attempts_at DEFAULT SYSUTCDATETIME(),
        succeeded    BIT           NOT NULL,

        -- No FK to Users. This is the audit trail of who tried to get in, and
        -- it should not disappear when an account is deleted -- least of all
        -- when the deletion is the thing being investigated.
        CONSTRAINT PK_LoginAttempts PRIMARY KEY (attempt_id)
    );

    -- Both counting questions are "how many failures recently", by one key or
    -- the other, so both get an index leading on that key and the time.
    CREATE INDEX IX_Attempts_user ON auth.LoginAttempts (user_id, attempted_at) INCLUDE (succeeded);
    CREATE INDEX IX_Attempts_ip   ON auth.LoginAttempts (ip, attempted_at)      INCLUDE (succeeded);

    PRINT 'CREATED auth.LoginAttempts';
END
ELSE
    PRINT 'auth.LoginAttempts already exists -- STOP and compare its columns';
GO


------------------------------------------------------------------------------
-- Grants. The API connects as sqlmillstream, the same login the load board
-- already uses.
--
-- No DELETE on LoginAttempts: the API only ever appends to it. Expiry sweeps
-- for Tokens and Sessions are the reason those two have it.
------------------------------------------------------------------------------
IF DATABASE_PRINCIPAL_ID('sqlmillstream') IS NOT NULL
BEGIN
    GRANT SELECT, INSERT, UPDATE, DELETE ON auth.Users    TO [sqlmillstream];
    GRANT SELECT, INSERT, UPDATE, DELETE ON auth.Tokens   TO [sqlmillstream];
    GRANT SELECT, INSERT, UPDATE, DELETE ON auth.Sessions TO [sqlmillstream];
    GRANT SELECT, INSERT                  ON auth.LoginAttempts TO [sqlmillstream];
    PRINT 'GRANTED auth.* to sqlmillstream';
END
ELSE
    PRINT 'sqlmillstream not found in this database -- grant by hand';
GO
