-- auth_00_inspect.sql
-- Read-only. Run this in the Millstream database and paste the three result
-- sets back. It is the first step of porting the DriverPayPortal login, and
-- everything about that port depends on what comes out of it.
--
-- WHAT THIS DELIBERATELY DOES NOT DO: select a password, a hash, or a salt.
-- Step 3 reports the LENGTH of those columns and whether they contain any
-- non-hex character -- enough to identify the algorithm, useless to an
-- attacker, and safe to paste into a chat window. If you ever want to widen
-- it, widen it to more columns, not to more rows of the same ones.
--
-- Nothing here writes. It is safe to run more than once.


------------------------------------------------------------------------------
-- STEP 1. Every table and column in the auth schema.
--
-- max_length is reported in BYTES by sys.columns, so an NVARCHAR(50) reads as
-- 100. The CASE converts the Unicode types back to characters, which is what
-- you would have written in the CREATE TABLE.
------------------------------------------------------------------------------
SELECT
    t.name                                   AS [table],
    c.column_id                              AS ord,
    c.name                                   AS [column],
    ty.name                                  AS [type],
    CASE
        WHEN c.max_length = -1               THEN -1        -- (max)
        WHEN ty.name IN (N'nchar', N'nvarchar') THEN c.max_length / 2
        ELSE c.max_length
    END                                      AS [length],
    c.is_nullable,
    c.is_identity
FROM sys.tables  t
JOIN sys.columns c  ON c.object_id      = t.object_id
JOIN sys.types   ty ON ty.user_type_id  = c.user_type_id
WHERE SCHEMA_NAME(t.schema_id) = N'auth'
ORDER BY t.name, c.column_id;


------------------------------------------------------------------------------
-- STEP 2. How many rows each table holds.
--
-- This says whether the schema is populated or just scaffolding, which decides
-- whether the port is a migration or a fresh start. sys.partitions is used
-- rather than COUNT(*) because it needs no read of the tables themselves.
------------------------------------------------------------------------------
SELECT
    t.name          AS [table],
    SUM(p.[rows])   AS [rows]
FROM sys.tables     t
JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
WHERE SCHEMA_NAME(t.schema_id) = N'auth'
GROUP BY t.name
ORDER BY t.name;


------------------------------------------------------------------------------
-- STEP 3. The shape of whatever is stored in the password-ish columns.
--
-- Length alone identifies the algorithm:
--
--     32 hex chars  -> MD5            (unsalted; must be replaced)
--     40 hex chars  -> SHA-1          (unsalted; must be replaced)
--     64 hex chars  -> SHA-256        (probably unsalted; check for a salt column)
--     60 chars, non-hex, starts $2    -> bcrypt   (already fine)
--     95+ chars, starts $argon2       -> argon2   (already fine)
--     short + varied + non-hex        -> plaintext (assume every one is burned)
--
-- A single length for every row means one algorithm. Two lengths means a
-- migration was started and not finished, which is worth knowing before we
-- start another one.
--
-- Dynamic SQL because the column names are exactly what we do not know yet.
-- QUOTENAME() is what makes that safe: the identifiers come from sys.columns,
-- never from input, and are bracketed before they reach the batch.
------------------------------------------------------------------------------
DECLARE @sql NVARCHAR(MAX) = N'';

SELECT @sql = @sql + N'
SELECT ' + QUOTENAME(t.name + N'.' + c.name, N'''') + N' AS [column],
       LEN(' + QUOTENAME(c.name) + N') AS [length],
       COUNT(*) AS [rows],
       MAX(CASE WHEN ' + QUOTENAME(c.name) + N' LIKE N''%[^0-9A-Fa-f]%''
                THEN 1 ELSE 0 END) AS has_non_hex
FROM auth.' + QUOTENAME(t.name) + N'
GROUP BY LEN(' + QUOTENAME(c.name) + N');'
FROM sys.tables  t
JOIN sys.columns c  ON c.object_id     = t.object_id
JOIN sys.types   ty ON ty.user_type_id = c.user_type_id
WHERE SCHEMA_NAME(t.schema_id) = N'auth'
  AND ty.name IN (N'char', N'nchar', N'varchar', N'nvarchar')
  AND (c.name LIKE N'%pass%' OR c.name LIKE N'%pwd%'
       OR c.name LIKE N'%hash%' OR c.name LIKE N'%salt%');

IF @sql = N''
    SELECT N'No password-like columns found in the auth schema.' AS note;
ELSE
    EXEC sp_executesql @sql;
