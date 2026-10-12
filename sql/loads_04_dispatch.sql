-- loads_04_dispatch.sql
-- Give a load a life: who is hauling it, in what, when it has to be where,
-- who the freight belongs to, and every change anyone made to it.
--
-- Before this, dbo.Loads was an advertisement. A load was Available or
-- Covered, and nothing in the app could move it from one to the other -- the
-- status changed only when somebody edited the row by hand. A dispatcher's
-- day is exactly that movement: assign a driver, watch it get picked up, mark
-- it delivered, and every one of those needed a SQL prompt.
--
-- Everything added here is NULLABLE or defaulted, so this runs safely against
-- the live table before the code that uses it deploys. The existing GET
-- selects columns by name and keeps working; the existing POST inserts the
-- old columns and the new ones default.
--
-- Run as sqlmillstream (db_owner). Requires settlement_05_link.sql, which is
-- where driver_code and delivered_date came from. Safe to re-run: everything
-- is guarded.

SET NOCOUNT ON;
GO

------------------------------------------------------------------------------
-- Status: five states instead of three.
--
--   Available   posted, nobody on it
--   Covered     a driver is assigned and has not picked up yet
--   In Transit  picked up, on the road
--   Delivered   done; the date is recorded and a settlement can pay for it
--   Cancelled   fell through; kept so the number is never reused for
--               different freight, and so a rate confirmation that names it
--               still points at something
--
-- The CHECK is replaced rather than altered because T-SQL has no ALTER
-- CONSTRAINT. Every existing row is one of the original three, so the new
-- constraint validates them without complaint.
------------------------------------------------------------------------------
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Loads_status')
   AND NOT EXISTS (
       SELECT 1 FROM sys.check_constraints
       WHERE name = N'CK_Loads_status' AND definition LIKE N'%In Transit%'
   )
BEGIN
    ALTER TABLE dbo.Loads DROP CONSTRAINT CK_Loads_status;
    PRINT 'DROPPED old CK_Loads_status';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Loads_status')
BEGIN
    ALTER TABLE dbo.Loads ADD CONSTRAINT CK_Loads_status
        CHECK (status IN (N'Available', N'Covered', N'In Transit', N'Delivered', N'Cancelled'));
    PRINT 'ADDED CK_Loads_status (5 states)';
END
GO

------------------------------------------------------------------------------
-- The truck. Free text for now, matching SettlementRoutes.unit_no and
-- Drivers.unit_no, which are the two places a unit number already lives. A
-- dbo.Trucks table is the next migration; when it exists this column gets a
-- foreign key and nothing that reads it has to change.
------------------------------------------------------------------------------
IF COL_LENGTH(N'dbo.Loads', N'unit_no') IS NULL
BEGIN
    ALTER TABLE dbo.Loads ADD unit_no VARCHAR(20) NULL;
    PRINT 'ADDED Loads.unit_no';
END
GO

------------------------------------------------------------------------------
-- Appointments. DATETIME2(0), naive, in the FACILITY's local time -- which is
-- how every rate confirmation and every dock writes them. Converting to UTC
-- would make "08:00 Chicago" and "08:00 Denver" into different numbers that
-- both have to be converted back before a driver can read them, and get one
-- wrong when the clocks change. A window is a start and an end; a fixed
-- appointment is a window with both the same.
------------------------------------------------------------------------------
IF COL_LENGTH(N'dbo.Loads', N'pickup_start') IS NULL
BEGIN
    ALTER TABLE dbo.Loads ADD
        pickup_start   DATETIME2(0) NULL,
        pickup_end     DATETIME2(0) NULL,
        delivery_start DATETIME2(0) NULL,
        delivery_end   DATETIME2(0) NULL;
    PRINT 'ADDED Loads pickup/delivery windows';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Loads_windows')
BEGIN
    ALTER TABLE dbo.Loads ADD CONSTRAINT CK_Loads_windows CHECK (
        (pickup_end   IS NULL OR pickup_start   IS NULL OR pickup_end   >= pickup_start) AND
        (delivery_end IS NULL OR delivery_start IS NULL OR delivery_end >= delivery_start)
    );
    PRINT 'ADDED CK_Loads_windows';
END
GO

------------------------------------------------------------------------------
-- The parties. origin and destination stay as the city the board shows; these
-- are the dock the driver actually has to find, and the phone number to call
-- when the gate is locked.
--
-- customer_name is text rather than a foreign key, deliberately and for now.
-- A dbo.Customers table is worth having, but it needs its own screen to be
-- useful, and a required foreign key to a table nobody can add to would stop
-- every load from being entered. Text first; promote it when the table exists.
------------------------------------------------------------------------------
IF COL_LENGTH(N'dbo.Loads', N'customer_name') IS NULL
BEGIN
    ALTER TABLE dbo.Loads ADD
        customer_name     NVARCHAR(100) NULL,
        reference_no      NVARCHAR(40)  NULL,   -- PO / BOL / customer's own number
        shipper_name      NVARCHAR(100) NULL,
        shipper_address   NVARCHAR(200) NULL,
        shipper_phone     VARCHAR(30)   NULL,
        consignee_name    NVARCHAR(100) NULL,
        consignee_address NVARCHAR(200) NULL,
        consignee_phone   VARCHAR(30)   NULL;
    PRINT 'ADDED Loads customer/shipper/consignee';
END
GO

------------------------------------------------------------------------------
-- The freight. What is on the trailer decides what trailer, what the scale
-- says, and whether the placards go on.
------------------------------------------------------------------------------
IF COL_LENGTH(N'dbo.Loads', N'commodity') IS NULL
BEGIN
    ALTER TABLE dbo.Loads ADD
        commodity   NVARCHAR(100) NULL,
        weight_lbs  INT           NULL,
        pieces      INT           NULL,
        hazmat      BIT           NOT NULL CONSTRAINT DF_Loads_hazmat DEFAULT 0,
        temp_f      SMALLINT      NULL,   -- reefer set point; NULL for anything else
        notes       NVARCHAR(1000) NULL;
    PRINT 'ADDED Loads freight details';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Loads_freight')
BEGIN
    ALTER TABLE dbo.Loads ADD CONSTRAINT CK_Loads_freight CHECK (
        (weight_lbs IS NULL OR weight_lbs > 0) AND
        (pieces     IS NULL OR pieces     > 0)
    );
    PRINT 'ADDED CK_Loads_freight';
END
GO

------------------------------------------------------------------------------
-- Who touched it last. created_by/updated_by hold the account's email, not a
-- UserId: auth.Users is a different schema owned by a different app, and an
-- audit column that breaks when an account is deleted is an audit column that
-- forbids deleting accounts.
------------------------------------------------------------------------------
IF COL_LENGTH(N'dbo.Loads', N'created_utc') IS NULL
BEGIN
    ALTER TABLE dbo.Loads ADD
        created_utc DATETIME2(0) NOT NULL CONSTRAINT DF_Loads_created DEFAULT SYSUTCDATETIME(),
        created_by  NVARCHAR(256) NULL,
        updated_utc DATETIME2(0) NULL,
        updated_by  NVARCHAR(256) NULL;
    PRINT 'ADDED Loads audit columns';
END
GO

------------------------------------------------------------------------------
-- LoadEvents -- what happened to a load, in order.
--
-- One row per change: created, assigned, picked up, delivered, edited,
-- cancelled. This is the answer to "who put that driver on it" and "when did
-- it actually deliver", which the load row alone cannot give because it only
-- holds the present.
--
-- Append-only by convention. Nothing in the app updates or deletes a row here,
-- and the cascade on delete exists only so a load that was entered by mistake
-- can be removed at a SQL prompt without first sweeping its history.
--
-- actor is an email for the same reason created_by is: it has to outlive the
-- account. detail is free text for whatever the event needs to say -- the
-- driver assigned, the fields edited -- and is NOT parsed by anything, so it
-- can say it in words.
------------------------------------------------------------------------------
IF OBJECT_ID(N'dbo.LoadEvents', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.LoadEvents (
        event_id     INT IDENTITY(1,1) NOT NULL,
        load_id      VARCHAR(20)   NOT NULL,
        event_utc    DATETIME2(0)  NOT NULL CONSTRAINT DF_LoadEvents_utc DEFAULT SYSUTCDATETIME(),
        actor        NVARCHAR(256) NULL,
        event_type   VARCHAR(20)   NOT NULL,
        from_status  NVARCHAR(20)  NULL,
        to_status    NVARCHAR(20)  NULL,
        driver_code  VARCHAR(20)   NULL,
        detail       NVARCHAR(400) NULL,

        CONSTRAINT PK_LoadEvents PRIMARY KEY (event_id),
        CONSTRAINT FK_LoadEvents_load FOREIGN KEY (load_id)
            REFERENCES dbo.Loads (id) ON DELETE CASCADE,
        CONSTRAINT CK_LoadEvents_type CHECK (event_type IN
            ('Created', 'Assigned', 'Unassigned', 'Status', 'Edited'))
    );

    CREATE INDEX IX_LoadEvents_load ON dbo.LoadEvents (load_id, event_utc);
    PRINT 'CREATED dbo.LoadEvents';
END
ELSE
    PRINT 'dbo.LoadEvents already exists';
GO

------------------------------------------------------------------------------
-- The seeded Covered loads have nobody on them.
--
-- loads_02_data.sql marked eleven loads Covered as a label, back when the
-- word meant nothing more than a badge. The lifecycle rule below makes it
-- mean a driver is assigned, and a Covered load with a NULL driver_code is
-- the contradiction it exists to forbid -- which is exactly what the first
-- run of this script tripped over.
--
-- Put them back to Available rather than invent a driver for each. That is
-- the honest state of a load nobody has been assigned to, and covering them
-- through the app afterwards is the whole point of this change. Each one gets
-- an event saying so, which is why LoadEvents is created above this rather
-- than below it.
------------------------------------------------------------------------------
INSERT INTO dbo.LoadEvents (load_id, actor, event_type, from_status, to_status, detail)
SELECT id, N'loads_04_dispatch.sql', 'Status', N'Covered', N'Available',
       N'Marked Covered in seed data with no driver; set back to Available when the lifecycle rule arrived'
FROM dbo.Loads
WHERE status = N'Covered' AND driver_code IS NULL
  AND NOT EXISTS (SELECT 1 FROM dbo.LoadEvents e WHERE e.load_id = dbo.Loads.id AND e.actor = N'loads_04_dispatch.sql');

UPDATE dbo.Loads
   SET status = N'Available', updated_utc = SYSUTCDATETIME(), updated_by = N'loads_04_dispatch.sql'
 WHERE status = N'Covered' AND driver_code IS NULL;
PRINT CAST(@@ROWCOUNT AS varchar(10)) + ' Covered loads with no driver set back to Available';
GO

------------------------------------------------------------------------------
-- The lifecycle rule, replacing CK_Loads_delivered.
--
-- The old rule said: Delivered has a driver and a date, everything else has
-- neither. That made Covered a word rather than a fact -- a covered load could
-- not say who covered it. The new rule follows the states:
--
--   Available    no driver, no delivered date
--   Covered      a driver, no delivered date
--   In Transit   a driver, no delivered date
--   Delivered    a driver AND a delivered date
--   Cancelled    no delivered date (a driver may remain, as the record of
--                who had been on it when it fell through)
--
-- After the fix above every existing row satisfies this: available freight
-- has no driver, delivered freight has both, and there is no longer a
-- Covered load with nobody on it.
------------------------------------------------------------------------------
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Loads_delivered')
BEGIN
    ALTER TABLE dbo.Loads DROP CONSTRAINT CK_Loads_delivered;
    PRINT 'DROPPED CK_Loads_delivered';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Loads_lifecycle')
BEGIN
    ALTER TABLE dbo.Loads ADD CONSTRAINT CK_Loads_lifecycle CHECK (
        (status = N'Available'  AND driver_code IS NULL     AND delivered_date IS NULL) OR
        (status = N'Covered'    AND driver_code IS NOT NULL AND delivered_date IS NULL) OR
        (status = N'In Transit' AND driver_code IS NOT NULL AND delivered_date IS NULL) OR
        (status = N'Delivered'  AND driver_code IS NOT NULL AND delivered_date IS NOT NULL) OR
        (status = N'Cancelled'  AND delivered_date IS NULL)
    );
    PRINT 'ADDED CK_Loads_lifecycle';
END
GO

-- The board's first question is "what is due", so pickup is worth an index
-- once the table is big enough to care. Cheap now, and it documents intent.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Loads_status_pickup' AND object_id = OBJECT_ID(N'dbo.Loads'))
BEGIN
    CREATE INDEX IX_Loads_status_pickup ON dbo.Loads (status, pickup_start);
END
GO

------------------------------------------------------------------------------
-- What the schema now looks like
------------------------------------------------------------------------------
SELECT 'Loads.unit_no'          AS item, COL_LENGTH(N'dbo.Loads', N'unit_no')        AS present
UNION ALL SELECT 'Loads.pickup_start',    COL_LENGTH(N'dbo.Loads', N'pickup_start')
UNION ALL SELECT 'Loads.customer_name',   COL_LENGTH(N'dbo.Loads', N'customer_name')
UNION ALL SELECT 'Loads.commodity',       COL_LENGTH(N'dbo.Loads', N'commodity')
UNION ALL SELECT 'Loads.created_utc',     COL_LENGTH(N'dbo.Loads', N'created_utc')
UNION ALL SELECT 'LoadEvents',            CASE WHEN OBJECT_ID(N'dbo.LoadEvents', N'U') IS NULL THEN NULL ELSE 1 END
UNION ALL SELECT 'CK_Loads_lifecycle',    CASE WHEN EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Loads_lifecycle') THEN 1 ELSE NULL END;
GO
