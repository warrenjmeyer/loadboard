------------------------------------------------------------------------------
-- loads_07_rename.sql -- dbo.Loads.id becomes dbo.Loads.load_number.
--
-- WHY. The loads are being copied into TMS.Loads on another organisation's
-- server, whose column for the same fact is called `load_number`. Warren chose
-- to rename this side rather than map at copy time (2026-09-16), so the two
-- tables agree on the name.
--
-- sp_rename RENAMES, it does not recreate: the six foreign keys pointing at
-- this column (LoadStops, LoadCharges, Documents, InvoiceLines,
-- SettlementRoutes, and the stop cascade) follow the column itself and are
-- NOT dropped, so nothing needs rebuilding and no data moves. The primary key
-- keeps its name, PK_Loads, which is correct -- a constraint is not its
-- column.
--
-- The earlier migration files still say `id`, and they are left alone: they
-- are history, they have already run, and on a fresh database they run BEFORE
-- this one and create the column under its old name for this file to rename.
--
-- The API does the translating. Every query in api/src now reads
-- `l.load_number AS id`, so `GET /api/loads` still answers with `id` and the
-- browser, the tests and the render fixtures never learn about this. The
-- column name is a database fact, not a contract with the customer.
--
-- Re-running is safe: it does nothing once the column is already renamed.
------------------------------------------------------------------------------

SET NOCOUNT ON;
GO

IF  COL_LENGTH('dbo.Loads', 'load_number') IS NULL
AND COL_LENGTH('dbo.Loads', 'id')          IS NOT NULL
BEGIN
    EXEC sp_rename N'dbo.Loads.id', N'load_number', N'COLUMN';
    PRINT 'RENAMED dbo.Loads.id -> load_number';
END
ELSE IF COL_LENGTH('dbo.Loads', 'load_number') IS NOT NULL
    PRINT 'dbo.Loads.load_number already exists -- nothing to do.';
ELSE
    PRINT 'dbo.Loads has neither id nor load_number -- look before running anything else.';
GO

------------------------------------------------------------------------------
-- What it left behind: the column, and the keys that still point at it.
------------------------------------------------------------------------------
SELECT c.name AS column_name, t.name AS type_name, c.max_length, c.is_nullable
FROM sys.columns AS c
JOIN sys.types AS t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID(N'dbo.Loads') AND c.name IN ('id', 'load_number');

SELECT fk.name AS foreign_key, OBJECT_NAME(fk.parent_object_id) AS referencing_table,
       COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS points_at
FROM sys.foreign_keys AS fk
JOIN sys.foreign_key_columns AS fkc ON fkc.constraint_object_id = fk.object_id
WHERE fk.referenced_object_id = OBJECT_ID(N'dbo.Loads')
ORDER BY fk.name;
GO
