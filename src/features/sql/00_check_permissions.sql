------------------------------------------------------------------------------
-- 00_check_permissions.sql -- READ ONLY. Changes nothing.
--
-- What the signed-in login may do in this database, and which of the tabs'
-- tables are already here. Run it on mvp-techgacity before the setup
-- scripts, and whenever one says "permission denied": it says which right
-- is missing, and names you the way a GRANT has to.
--
-- Two result sets:
--   1. you, and each right the setup scripts need (1 = yes, 0 = no);
--   2. each table or view the scripts make or need: there, or not.
-- "Not there" can also mean "there, but you may not see it" -- this login
-- only sees objects it has some permission on.
------------------------------------------------------------------------------
SET NOCOUNT ON;

SELECT DB_NAME()                                            AS [database],
       USER_NAME()                                          AS [you, in this database],
       SUSER_SNAME()                                        AS [you, signed in as],
       IS_ROLEMEMBER('db_owner')                            AS [db_owner],
       HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CREATE TABLE') AS [may create tables],
       HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CREATE VIEW')  AS [may create views],
       HAS_PERMS_BY_NAME('DRVR', 'SCHEMA', 'ALTER')         AS [may add to DRVR],
       HAS_PERMS_BY_NAME('DRVR', 'SCHEMA', 'INSERT')        AS [may write DRVR],
       HAS_PERMS_BY_NAME('DRVR', 'SCHEMA', 'REFERENCES')    AS [may reference DRVR],
       HAS_PERMS_BY_NAME('TMS.Loads', 'OBJECT', 'SELECT')   AS [may read TMS.Loads],
       HAS_PERMS_BY_NAME('TMS.Loads', 'OBJECT', 'REFERENCES') AS [may reference TMS.Loads];

SELECT v.name AS [table or view], v.madeBy AS [made by],
       CASE WHEN OBJECT_ID(v.name) IS NULL THEN 'not there (or not visible to you)' ELSE 'there' END AS [here?]
  FROM (VALUES
        ('TMS.Loads',                 'the TMS side'),
        ('DRVR.fk_Home_Time_Status',  'the app'),
        ('DRVR.fk_Home_Time_Source',  'the app'),
        ('DRVR.fk_Load_Plan_Status',  'the app'),
        ('DRVR.Drivers',              '01_DRVR_Drivers.sql'),
        ('DRVR.Home_Time_Stays',      '02_DRVR_Home_Time_Stays.sql'),
        ('DRVR.Home_Time_Stay_History', '08_DRVR_Home_Time_Stay_History.sql'),
        ('DRVR.Load_Plans',           '04_DRVR_Load_Plans.sql'),
        ('DRVR.Loads_For_Planning',   '04_DRVR_Load_Plans.sql')) v(name, madeBy);
