-- loads_05_payrun.sql
-- The one column a pay run needs that a load did not have: empty miles.
--
-- A settlement line carries loaded miles and empty miles and pays on the
-- total (settlement_01_ddl.sql). A load carried only its loaded miles, so a
-- pay run generated from loads would have paid nobody for deadhead. The
-- dispatcher knows the deadhead when they assign the load -- it is the
-- distance from where the truck delivered last to where this one picks up --
-- so it goes on the load, editable, defaulting to zero.
--
-- Run as sqlmillstream (db_owner). Requires loads_04_dispatch.sql. Safe to
-- re-run.

SET NOCOUNT ON;
GO

IF COL_LENGTH(N'dbo.Loads', N'empty_miles') IS NULL
BEGIN
    ALTER TABLE dbo.Loads ADD empty_miles INT NOT NULL
        CONSTRAINT DF_Loads_empty DEFAULT 0;
    PRINT 'ADDED Loads.empty_miles';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Loads_empty')
BEGIN
    ALTER TABLE dbo.Loads ADD CONSTRAINT CK_Loads_empty CHECK (empty_miles >= 0);
    PRINT 'ADDED CK_Loads_empty';
END
GO

-- The delivered loads that already have a settlement line know their empty
-- miles from that line. Copy them back so the load agrees with the statement
-- that paid for it. Only rows still at the default are touched.
UPDATE l
   SET l.empty_miles = r.empty_miles
  FROM dbo.Loads AS l
  JOIN dbo.SettlementRoutes AS r ON r.load_id = l.id
 WHERE l.empty_miles = 0 AND r.empty_miles > 0;
PRINT CAST(@@ROWCOUNT AS varchar(10)) + ' loads given the empty miles their settlement line recorded';
GO

SELECT 'Loads.empty_miles' AS item, COL_LENGTH(N'dbo.Loads', N'empty_miles') AS present
UNION ALL SELECT 'Delivered loads not yet on a settlement',
       (SELECT COUNT(*) FROM dbo.Loads AS l
         WHERE l.status = N'Delivered'
           AND NOT EXISTS (SELECT 1 FROM dbo.SettlementRoutes AS r WHERE r.load_id = l.id));
GO
