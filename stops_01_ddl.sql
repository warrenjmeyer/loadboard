-- stops_01_ddl.sql
-- A load with more than two ends.
--
-- Until now a load was an origin and a destination, a shipper and a
-- consignee, a pickup window and a delivery window: six columns that
-- describe exactly one pickup and exactly one delivery. Real freight picks
-- up at two docks and drops at three, and the only way to enter that was
-- the notes field.
--
-- dbo.LoadStops is the itinerary: one row per stop, in sequence, each a
-- Pickup or a Delivery with its own dock, window and reference number, and
-- its own arrived / departed times for the driver to check in against.
--
-- THE SIX COLUMNS ON dbo.Loads STAY, AS A SUMMARY. origin, shipper_* and
-- pickup_* say what the FIRST stop says; destination, consignee_* and
-- delivery_* say what the LAST stop says. The API rewrites them whenever
-- the stops change (stopRules.summaryFrom), so the board, the settlement
-- route detail, the invoice line and the GeoTab route name -- all of which
-- read "origin - destination" -- go on working without knowing stops
-- exist. The stops are the truth; the six columns are its headline.
--
-- Two rules the API enforces and this schema only partly can: the first
-- stop is a Pickup, the last is a Delivery, and there are at least two.
-- (A CHECK cannot see other rows. The unique (load_id, seq) is what SQL
-- can promise.)
--
-- ON DELETE CASCADE from Loads, like LoadEvents and LoadCharges: a stop
-- with no load is nothing.
--
-- Run as sqlmillstream (db_owner). Requires loads_04_dispatch.sql. Safe to
-- re-run: guarded, and the seed skips loads that already have stops.

SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.LoadStops', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.LoadStops (
        stop_id       INT IDENTITY(1,1) NOT NULL,
        load_id       VARCHAR(20)   NOT NULL,
        seq           SMALLINT      NOT NULL,        -- 1..n, the order driven
        stop_type     VARCHAR(10)   NOT NULL,        -- Pickup or Delivery
        place         NVARCHAR(100) NOT NULL,        -- "Cedar Rapids, IA": what the board prints
        name          NVARCHAR(100) NULL,            -- the shipper or consignee at this dock
        address       NVARCHAR(200) NULL,
        phone         VARCHAR(30)   NULL,
        window_start  DATETIME2(0)  NULL,            -- appointment, in the dock's local time
        window_end    DATETIME2(0)  NULL,
        reference_no  NVARCHAR(40)  NULL,            -- this stop's PO / BOL / pickup number
        notes         NVARCHAR(400) NULL,            -- "dock 14, call ahead"
        arrived_utc   DATETIME2(0)  NULL,            -- the driver's check-in
        departed_utc  DATETIME2(0)  NULL,

        CONSTRAINT PK_LoadStops PRIMARY KEY (stop_id),
        CONSTRAINT UQ_LoadStops_seq UNIQUE (load_id, seq),
        CONSTRAINT FK_LoadStops_load FOREIGN KEY (load_id) REFERENCES dbo.Loads (id) ON DELETE CASCADE,
        CONSTRAINT CK_LoadStops_type CHECK (stop_type IN ('Pickup', 'Delivery')),
        CONSTRAINT CK_LoadStops_seq CHECK (seq >= 1),
        CONSTRAINT CK_LoadStops_window CHECK (window_end IS NULL OR window_start IS NULL OR window_end >= window_start),
        CONSTRAINT CK_LoadStops_checkin CHECK (departed_utc IS NULL OR arrived_utc IS NOT NULL)
    );
    PRINT 'CREATED dbo.LoadStops';
END
ELSE
    PRINT 'dbo.LoadStops already exists';
GO

-- The driver checking in at a dock is an event on the load, like a status
-- change. Two more words the history can say.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_LoadEvents_type')
   AND NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_LoadEvents_type' AND definition LIKE '%Arrived%')
BEGIN
    ALTER TABLE dbo.LoadEvents DROP CONSTRAINT CK_LoadEvents_type;
    ALTER TABLE dbo.LoadEvents ADD CONSTRAINT CK_LoadEvents_type CHECK (event_type IN
        ('Created', 'Assigned', 'Unassigned', 'Status', 'Edited', 'Arrived', 'Departed'));
    PRINT 'WIDENED CK_LoadEvents_type';
END
GO

------------------------------------------------------------------------------
-- Seed: every load gets the two stops its six columns already describe.
-- Only loads with no stops, so a load somebody has already given a third
-- stop through the app is left alone.
------------------------------------------------------------------------------
INSERT INTO dbo.LoadStops (load_id, seq, stop_type, place, name, address, phone, window_start, window_end)
SELECT l.id, 1, 'Pickup', l.origin, l.shipper_name, l.shipper_address, l.shipper_phone, l.pickup_start, l.pickup_end
  FROM dbo.Loads AS l
 WHERE NOT EXISTS (SELECT 1 FROM dbo.LoadStops AS s WHERE s.load_id = l.id);
DECLARE @pickups INT = @@ROWCOUNT;

INSERT INTO dbo.LoadStops (load_id, seq, stop_type, place, name, address, phone, window_start, window_end)
SELECT l.id, 2, 'Delivery', l.destination, l.consignee_name, l.consignee_address, l.consignee_phone, l.delivery_start, l.delivery_end
  FROM dbo.Loads AS l
 WHERE NOT EXISTS (SELECT 1 FROM dbo.LoadStops AS s WHERE s.load_id = l.id AND s.seq = 2);
DECLARE @deliveries INT = @@ROWCOUNT;

PRINT 'Seeded ' + CAST(@pickups AS varchar(10)) + ' pickups and ' + CAST(@deliveries AS varchar(10)) + ' deliveries';
GO

------------------------------------------------------------------------------
-- What the schema now looks like
------------------------------------------------------------------------------
SELECT 'LoadStops'                    AS item, (SELECT COUNT(*) FROM dbo.LoadStops) AS present
UNION ALL SELECT 'Loads with stops',           (SELECT COUNT(DISTINCT load_id) FROM dbo.LoadStops)
UNION ALL SELECT 'Loads without',              (SELECT COUNT(*) FROM dbo.Loads AS l WHERE NOT EXISTS (SELECT 1 FROM dbo.LoadStops AS s WHERE s.load_id = l.id))
UNION ALL SELECT 'Loads with more than two',   (SELECT COUNT(*) FROM (SELECT load_id FROM dbo.LoadStops GROUP BY load_id HAVING COUNT(*) > 2) AS x)
UNION ALL SELECT 'CK_LoadEvents_type widened', CASE WHEN EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_LoadEvents_type' AND definition LIKE '%Arrived%') THEN 1 ELSE 0 END;
GO
