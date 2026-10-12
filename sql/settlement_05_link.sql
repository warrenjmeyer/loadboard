-- settlement_05_link.sql
-- Connect the load board to the settlements.
--
-- Before this, dbo.Loads and dbo.SettlementRoutes were unrelated: order_no and
-- Loads.id were two text columns with no constraint between them. The board
-- advertised freight nobody was paid for, and drivers were paid for trips that
-- never existed as loads. For a settlement -- a document whose job is to be
-- checkable -- that is the wrong shape.
--
-- ORDER MATTERS:
--   1. loads_02_data.sql          (board loads set to current freight only)
--   2. settlement_05_link.sql     (this file)
--   3. loads_03_delivered.sql     (the loads the settlements reference)
--   4. settlement_02/03/04        (routes now carrying load_id)
--
-- Step 1 first because CK_Loads_delivered validates existing rows: a load
-- marked Delivered with no driver -- which the board had five of -- makes this
-- script fail rather than silently accepting bad data.
--
-- Safe to re-run: every change is guarded.

SET NOCOUNT ON;

------------------------------------------------------------------------------
-- Loads: who ran it, and when it delivered
------------------------------------------------------------------------------
IF COL_LENGTH(N'dbo.Loads', N'driver_code') IS NULL
BEGIN
    ALTER TABLE dbo.Loads ADD driver_code VARCHAR(20) NULL;
END
GO

IF COL_LENGTH(N'dbo.Loads', N'delivered_date') IS NULL
BEGIN
    ALTER TABLE dbo.Loads ADD delivered_date DATE NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Loads_driver')
BEGIN
    ALTER TABLE dbo.Loads ADD CONSTRAINT FK_Loads_driver
        FOREIGN KEY (driver_code) REFERENCES dbo.Drivers (driver_code);
END
GO

-- A delivered load has a driver and a date; a load that is not delivered has
-- neither. Half-delivered rows -- a delivery date with nobody attached, or a
-- driver on a load still sitting available -- are exactly what this whole
-- change exists to prevent, so the database refuses them rather than trusting
-- every future INSERT to remember.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Loads_delivered')
BEGIN
    ALTER TABLE dbo.Loads ADD CONSTRAINT CK_Loads_delivered CHECK (
        (status = 'Delivered' AND driver_code IS NOT NULL AND delivered_date IS NOT NULL)
        OR
        (status <> 'Delivered' AND driver_code IS NULL AND delivered_date IS NULL)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Loads_driver' AND object_id = OBJECT_ID(N'dbo.Loads'))
BEGIN
    CREATE INDEX IX_Loads_driver ON dbo.Loads (driver_code) INCLUDE (delivered_date);
END
GO

------------------------------------------------------------------------------
-- SettlementRoutes: which load this trip was
------------------------------------------------------------------------------
IF COL_LENGTH(N'dbo.SettlementRoutes', N'load_id') IS NULL
BEGIN
    ALTER TABLE dbo.SettlementRoutes ADD load_id VARCHAR(20) NULL;
END
GO

-- Nullable ONLY because a SPECIAL line is real pay for no load: breakdown pay,
-- layover, a guarantee top-up. Those are not freight and must not be forced to
-- invent a load to point at. Every other line should carry one.
--
-- NO ACTION on delete, deliberately: deleting a load that a driver was paid for
-- should fail loudly rather than quietly cascade the evidence away.
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Routes_load')
BEGIN
    ALTER TABLE dbo.SettlementRoutes ADD CONSTRAINT FK_Routes_load
        FOREIGN KEY (load_id) REFERENCES dbo.Loads (id);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Routes_load' AND object_id = OBJECT_ID(N'dbo.SettlementRoutes'))
BEGIN
    CREATE INDEX IX_Routes_load ON dbo.SettlementRoutes (load_id);
END
GO

------------------------------------------------------------------------------
-- What the schema now looks like
------------------------------------------------------------------------------
SELECT 'Loads.driver_code'              AS item, COL_LENGTH(N'dbo.Loads', N'driver_code')            AS present
UNION ALL SELECT 'Loads.delivered_date',        COL_LENGTH(N'dbo.Loads', N'delivered_date')
UNION ALL SELECT 'SettlementRoutes.load_id',    COL_LENGTH(N'dbo.SettlementRoutes', N'load_id');
GO
