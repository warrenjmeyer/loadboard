-- auth_01_roles.sql
-- Adds authorization to the auth schema. Authentication is already there and
-- is not touched.
--
-- This script replaces an earlier auth_01_ddl.sql that proposed a parallel set of
-- tables; that was written before anyone had looked, and the schema it would
-- have created already existed in better form.
--
-- Guarded and re-runnable: each ALTER checks for its own column first.
--
-- WHAT WAS ALREADY HERE, and is deliberately left alone:
--
--   Users            identity + PublicId + email confirmation + IsActive
--   UserPasswords    hash history, with an Algorithm column and IsCurrent
--   SecurityTokens   binary(32) hashes, Consumed and Invalidated separately
--   Sessions         binary(32) hashes, revocation with a reason
--   LoginAttempts    per-email and per-IP, with a failure reason
--   RateLimits       bucketed by subject and IP
--   AuthEvents       the audit trail
--
-- WHAT WAS MISSING is the answer to "and what may this person DO", which is
-- what open registration with admin approval needs, and what stops one driver
-- reading another's settlement.

SET NOCOUNT ON;
GO

------------------------------------------------------------------------------
-- Users.Role -- what an approved account may do.
--
-- Registration is open and a new account is powerless until approved, so
-- 'none' is the default and every new row starts there. That is a different
-- question from IsActive, and the two are kept apart on purpose:
--
--   IsActive = 0            may not authenticate at all (disabled, locked)
--   IsActive = 1, 'none'    signed in, awaiting approval, can see nothing
--   IsActive = 1, a role    approved
--
-- Folding "awaiting approval" into IsActive = 0 would make it indistinguishable
-- from "disabled", and the two need different answers at the login screen:
-- one is "we will get to you", the other is "no".
--
-- A single column rather than a Roles/UserRoles pair. Nobody here holds two
-- roles at once -- a driver is not also a dispatcher -- and a join table that
-- never has two rows per user is a join for its own sake. If that stops being
-- true, this becomes the migration to write.
------------------------------------------------------------------------------
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'auth.Users') AND name = N'Role'
)
BEGIN
    ALTER TABLE auth.Users
        ADD [Role] VARCHAR(20) NOT NULL
            CONSTRAINT DF_Users_Role DEFAULT 'none';
    PRINT 'ADDED auth.Users.Role';
END
ELSE
    PRINT 'auth.Users.Role already exists';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Users_Role'
)
BEGIN
    ALTER TABLE auth.Users
        ADD CONSTRAINT CK_Users_Role
            CHECK ([Role] IN ('none', 'driver', 'dispatcher', 'admin'));
    PRINT 'ADDED CK_Users_Role';
END
ELSE
    PRINT 'CK_Users_Role already exists';
GO


------------------------------------------------------------------------------
-- Users.DriverCode -- which driver this login IS, when it is a driver.
--
-- This is the column that makes a pay statement private. Today every
-- settlement route is anonymous, so /api/drivers/JSMITH/settlements hands
-- anyone's pay to anyone with the URL. With this, the API compares the code in
-- the URL to the code on the session and a driver sees their own and no one
-- else's.
--
-- VARCHAR(20) to match dbo.Drivers.driver_code exactly -- a type mismatch here
-- would either refuse the foreign key or force an implicit conversion on every
-- comparison.
------------------------------------------------------------------------------
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'auth.Users') AND name = N'DriverCode'
)
BEGIN
    ALTER TABLE auth.Users ADD DriverCode VARCHAR(20) NULL;
    PRINT 'ADDED auth.Users.DriverCode';
END
ELSE
    PRINT 'auth.Users.DriverCode already exists';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Users_Driver'
)
BEGIN
    ALTER TABLE auth.Users
        ADD CONSTRAINT FK_Users_Driver FOREIGN KEY (DriverCode)
            REFERENCES dbo.Drivers (driver_code);
    PRINT 'ADDED FK_Users_Driver';
END
ELSE
    PRINT 'FK_Users_Driver already exists';
GO

------------------------------------------------------------------------------
-- A driver login must say which driver; anyone else must not claim one.
--
-- Without this, a row with Role='driver' and a NULL DriverCode would compare
-- NULL to the code in the URL. That comparison is never true in SQL, so it
-- would fail closed rather than open -- but it would also mean a driver who
-- cannot see their own statement and no obvious reason why. Better to make the
-- row impossible.
------------------------------------------------------------------------------
IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Users_DriverCode'
)
BEGIN
    ALTER TABLE auth.Users
        ADD CONSTRAINT CK_Users_DriverCode
            CHECK (([Role] =  'driver' AND DriverCode IS NOT NULL)
                OR ([Role] <> 'driver' AND DriverCode IS NULL));
    PRINT 'ADDED CK_Users_DriverCode';
END
ELSE
    PRINT 'CK_Users_DriverCode already exists';
GO


------------------------------------------------------------------------------
-- Where that leaves the one account that already exists.
--
-- It defaulted to Role='none' like every other row, so it can sign in and do
-- nothing until it is approved. Promote it by hand -- there is no admin screen
-- yet, and this is the bootstrap problem every approval system has: somebody
-- has to be the first admin, and it cannot be another admin who does it.
--
-- Fill in the address and run it.
------------------------------------------------------------------------------
-- UPDATE auth.Users
--    SET [Role] = 'admin', ModifiedUtc = SYSUTCDATETIME()
--  WHERE EmailNormalized = N'<your address, lower-cased>';
GO


------------------------------------------------------------------------------
-- What is left after this, and is NOT done here.
--
-- The one existing password is bcrypt (60 characters, non-hex -- a $2 hash).
-- The API hashes with scrypt and records 'scrypt' in UserPasswords.Algorithm,
-- and it refuses any row whose algorithm it does not implement rather than
-- guessing. So that account cannot log in with its current password.
--
-- Deliberately not solved by adding a bcrypt library: one account does not
-- justify a dependency, and every candidate is either a native module that can
-- fail the CI build or a pure-JS reimplementation to be trusted. Set a new
-- password through the reset link instead. The Algorithm column is what makes
-- this a choice rather than a problem -- if there were a thousand of these,
-- the same column is what would let both hashes coexist during a migration.
------------------------------------------------------------------------------
