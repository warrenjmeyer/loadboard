------------------------------------------------------------------------------
-- local_test_users.sql -- LAPTOP ONLY. Gives each driver on the laptop a
-- made-up user, so the preview can act AS a driver.
--
-- On the host, DRVR.Drivers.User_Uuid ties a driver to the account they
-- sign in with, and every "WHO: that driver" check goes through it. The
-- laptop has no accounts, so the preview's driver view says whom it is
-- acting as (tools/local-db/plugin.mjs) and the check looks up this column
-- -- exactly as it would a real user. A driver with no user here can read
-- nothing as themselves, which is the check working.
--
-- Only fills the empty ones; safe to run again. The drivers copy never
-- touches User_Uuid, so a fresh copy keeps them.
------------------------------------------------------------------------------
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 5
    THROW 50000, 'This is Azure SQL. Made-up users are for the laptop''s test copy only.', 1;
IF DB_NAME() <> N'mvp-techgacity'
    THROW 50000, 'Run this in the laptop''s mvp-techgacity (made by local_stand_in.sql).', 1;

UPDATE DRVR.Drivers SET User_Uuid = NEWID(), Updated_At = getdate() WHERE User_Uuid IS NULL;
PRINT CONCAT(@@ROWCOUNT, ' driver(s) given a made-up user.');
