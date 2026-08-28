-- loads_00_diagnose.sql
-- Run this first. It answers: who am I, what can I create, and does a Loads
-- table already exist somewhere I can reach? Read-only -- safe to run.

SELECT
    SUSER_SNAME()                                   AS login_name,
    USER_NAME()                                     AS db_user,
    DB_NAME()                                       AS current_db,
    IS_SRVROLEMEMBER('sysadmin')                    AS is_sysadmin,
    IS_ROLEMEMBER('db_owner')                       AS is_db_owner,
    IS_ROLEMEMBER('db_ddladmin')                    AS is_db_ddladmin,
    IS_ROLEMEMBER('db_datawriter')                  AS is_db_datawriter,
    HAS_PERMS_BY_NAME(NULL, NULL, 'CREATE TABLE')   AS can_create_table;

-- Schemas you are allowed to create objects in (need ALTER or CONTROL here
-- *and* CREATE TABLE at the database level above):
SELECT s.name AS schema_name, USER_NAME(s.principal_id) AS schema_owner
FROM sys.schemas AS s
WHERE HAS_PERMS_BY_NAME(s.name, 'SCHEMA', 'ALTER') = 1
  AND s.name NOT IN ('sys', 'INFORMATION_SCHEMA')
ORDER BY s.name;

-- Does a Loads-ish table already exist that you could just insert into?
SELECT
    s.name  AS schema_name,
    t.name  AS table_name,
    HAS_PERMS_BY_NAME(QUOTENAME(s.name) + '.' + QUOTENAME(t.name),
                      'OBJECT', 'INSERT') AS can_insert,
    HAS_PERMS_BY_NAME(QUOTENAME(s.name) + '.' + QUOTENAME(t.name),
                      'OBJECT', 'SELECT') AS can_select
FROM sys.tables AS t
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
WHERE t.name LIKE '%Load%'
ORDER BY s.name, t.name;
