------------------------------------------------------------------------------
-- 00_grant_setup_rights.sql -- FOR THE DATABASE OWNER of mvp-techgacity, not
-- for the person running the setup scripts.
--
-- Gives one user exactly what 01, 02 and 04 and the copy scripts need, and
-- no more -- not db_owner. Set @Who to the name 00_check_permissions.sql
-- shows under "you, in this database", then run it.
--
-- What each grant is for:
--   CREATE TABLE, CREATE VIEW       01, 02 and 04 create tables; 04 a view.
--   ALTER on schema DRVR            creating anything IN a schema needs it.
--   SELECT, INSERT, UPDATE on DRVR  the copies and seeds, and trying the
--                                   reads (05) and writes (06).
--   REFERENCES on schema DRVR       the new tables' foreign keys to
--                                   DRVR.Drivers and the fk_ lookups.
--   REFERENCES on TMS.Loads         the plans' foreign key to TMS.Loads.
--                                   Leave this one out to keep loads free to
--                                   delete: 04 then skips that key and prints
--                                   the line to add it later.
--
-- FOR Warren@Techgacity.com, checked 2026-09-30 with 00_check_permissions:
-- he ALREADY holds ALTER, INSERT and REFERENCES on DRVR and REFERENCES on
-- TMS.Loads. What he lacks is CREATE TABLE and CREATE VIEW -- the two
-- database-wide rights. So for him this whole script comes down to:
--
--     GRANT CREATE TABLE, CREATE VIEW TO [Warren@Techgacity.com];
--
-- Running the full script instead does no harm: granting a right someone
-- already holds changes nothing, and it makes sure of SELECT and UPDATE.
--
-- A NOTE ON ALTER, for anyone else. SQL Server has no "create in this
-- schema, but touch nothing else there": ALTER on DRVR also lets a user
-- change or drop the other tables in DRVR, the app's fk_ lookups included.
------------------------------------------------------------------------------
SET NOCOUNT ON;
SET XACT_ABORT ON;   -- all four grants, or none

DECLARE @Who sysname = N'';   -- the name from 00_check_permissions.sql

-- DATABASE_PRINCIPAL_ID, not USER_ID: USER_ID('') answers with the CURRENT
-- user, so an empty name would sail through. (A test caught exactly that.)
IF NULLIF(LTRIM(RTRIM(@Who)), N'') IS NULL OR DATABASE_PRINCIPAL_ID(@Who) IS NULL
    THROW 50000, 'No user by that name in this database. Paste the name from 00_check_permissions.sql ("you, in this database").', 1;

DECLARE @q nvarchar(300) = QUOTENAME(@Who);
BEGIN TRANSACTION;
EXEC (N'GRANT CREATE TABLE TO ' + @q);
EXEC (N'GRANT CREATE VIEW TO ' + @q);
EXEC (N'GRANT ALTER, SELECT, INSERT, UPDATE, REFERENCES ON SCHEMA::DRVR TO ' + @q);
EXEC (N'GRANT REFERENCES ON OBJECT::TMS.Loads TO ' + @q);
COMMIT TRANSACTION;

PRINT CONCAT(@Who, ' may now create the DRVR tables and fill them. Nothing else changed.');
