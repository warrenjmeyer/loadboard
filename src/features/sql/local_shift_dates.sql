------------------------------------------------------------------------------
-- local_shift_dates.sql -- LAPTOP ONLY. Brings the test loads into this week.
--
-- The loads copied from Millstream are dated Sep 9-18, and all but one of
-- the open loads have no times at all, so a week from today shows nothing
-- to plan. This moves the laptop's copy -- never Millstream, never the host:
--
--   1. Every load not Delivered or Cancelled moves forward by whole days, so
--      the latest In Transit pickup lands on today. A dock's time of day
--      stays as it was; only the date moves. Delivered loads stay put --
--      moved, they would be delivered in the future.
--   2. Open loads with no times get them: pickups spread over the next
--      seven days (this afternoon, then 7-10 AM each day after), and a
--      delivery window worked out from the miles -- 50 mph, an hour to
--      load, and a 10-hour rest for every full 11 hours of driving.
--
-- Changed rows get updated_utc = now and updated_by = 'local_shift_dates.sql'.
--
-- RUN IN: the laptop's mvp-techgacity (it refuses to run anywhere else).
-- Again the same day: nothing moves. Again another day: everything moves up
-- by the days since. After copying loads from Millstream again, run it
-- again -- the copy puts the old dates back.
------------------------------------------------------------------------------
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 5
    THROW 50000, 'This is Azure SQL. This script only moves the laptop''s test copy.', 1;
IF DB_NAME() <> N'mvp-techgacity'
    THROW 50000, 'Run this in the laptop''s mvp-techgacity (made by local_stand_in.sql).', 1;

DECLARE @Today  date = CAST(SYSDATETIME() AS date);
DECLARE @Anchor date = (SELECT CAST(MAX(pickup_start) AS date) FROM TMS.Loads WHERE status = N'In Transit');
DECLARE @Days   int  = ISNULL(DATEDIFF(day, @Anchor, @Today), 0);

-- 1. Forward by whole days.
UPDATE TMS.Loads
   SET pickup_start   = DATEADD(day, @Days, pickup_start),
       pickup_end     = DATEADD(day, @Days, pickup_end),
       delivery_start = DATEADD(day, @Days, delivery_start),
       delivery_end   = DATEADD(day, @Days, delivery_end),
       updated_utc    = SYSUTCDATETIME(),
       updated_by     = N'local_shift_dates.sql'
 WHERE @Days <> 0
   AND status NOT IN (N'Delivered', N'Cancelled')
   AND COALESCE(pickup_start, pickup_end, delivery_start, delivery_end) IS NOT NULL;
DECLARE @Moved int = @@ROWCOUNT;

-- 2. Times for the open loads that have none.
WITH untimed AS (
    SELECT load_uuid, miles, (ROW_NUMBER() OVER (ORDER BY load_number) - 1) % 7 AS dayOffset
      FROM TMS.Loads
     WHERE status = N'Available' AND pickup_start IS NULL AND pickup_end IS NULL
), planned AS (
    SELECT load_uuid,
           DATEADD(hour, CASE WHEN dayOffset = 0 THEN 13 ELSE 7 END, CAST(DATEADD(day, dayOffset, @Today) AS datetime2)) AS pickupAt,
           CAST(CEILING(miles / 50.0) AS int) AS driveHours
      FROM untimed
)
UPDATE l
   SET pickup_start   = p.pickupAt,
       pickup_end     = DATEADD(hour, 3, p.pickupAt),
       delivery_start = DATEADD(hour, 1 + p.driveHours + 10 * ((p.driveHours - 1) / 11), p.pickupAt),
       delivery_end   = DATEADD(hour, 5 + p.driveHours + 10 * ((p.driveHours - 1) / 11), p.pickupAt),
       updated_utc    = SYSUTCDATETIME(),
       updated_by     = N'local_shift_dates.sql'
  FROM TMS.Loads l
  JOIN planned p ON p.load_uuid = l.load_uuid;
DECLARE @Timed int = @@ROWCOUNT;

PRINT CONCAT('Moved ', @Moved, ' load(s) forward ', @Days, ' day(s). Gave times to ', @Timed, ' open load(s) that had none.');

-- What this week looks like now.
SELECT CONVERT(varchar(10), CAST(pickup_start AS date), 23) AS [pickup day], DATENAME(weekday, pickup_start) AS [day],
       SUM(CASE WHEN status = N'Available'  THEN 1 ELSE 0 END) AS [open],
       SUM(CASE WHEN status = N'Covered'    THEN 1 ELSE 0 END) AS [covered],
       SUM(CASE WHEN status = N'In Transit' THEN 1 ELSE 0 END) AS [in transit]
  FROM TMS.Loads
 WHERE status NOT IN (N'Delivered', N'Cancelled')
 GROUP BY CAST(pickup_start AS date), DATENAME(weekday, pickup_start)
 ORDER BY CAST(pickup_start AS date);
