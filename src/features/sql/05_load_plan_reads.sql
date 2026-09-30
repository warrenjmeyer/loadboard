------------------------------------------------------------------------------
-- 05_load_plan_reads.sql -- the four reads the Driver Load Plans tab makes,
-- as the server runs them, each with WHO may make it written into it.
--
-- NOT A SETUP SCRIPT. These are the API's queries, runnable here with the
-- parameters below to see what each returns before any API code exists.
-- Nothing here writes, so the whole file can be run at once. They answer as
-- driver-load-plans/scope.ts does, and scope.test.ts is the list of what
-- that means.
--
-- NEEDS: 04_DRVR_Load_Plans.sql (DRVR.Loads_For_Planning) and
-- 02_DRVR_Home_Time_Stays.sql -- the home time a load must not run into is
-- the schedule's APPROVED and HOME stays.
--
-- WHO. Every read is dispatch's alone: the tab is dispatch's. The API fills
-- the caller parameters from the session -- never from the request body:
--   @CallerUuid        the signed-in user
--   @CallerIsDispatch  1 for dispatch or admin
-- Anyone else is REFUSED (THROW 50403), not answered with an empty list.
--
-- SHAPE. Each read returns up to three result sets -- loads, drivers, stays
-- -- with the columns named as contract.ts names them. What the API adds
-- before handing them over:
--   * a ZONE for each load time. TMS.Loads keeps a dock's wall-clock time
--     with none; the dock's state gives it (get-me-home/adapters/dockTime.ts
--     does exactly this for the load board);
--   * MAP POSITIONS for each place ("JOLIET, IL"), and each driver's
--     position and hours from GeoTab -- none of which is in this database.
--
-- WINDOWS. A board or open-load window is exact moments; a load's times have
-- no zone until the API gives them one. So the loads are picked with a day
-- to spare on each side, and the API trims them to the exact window with
-- scope.ts once each time has its zone. A day covers every US zone.
------------------------------------------------------------------------------
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

-- Try it: set these, then run the file, or one read at a time.
DECLARE @CallerUuid       uniqueidentifier  = NULL;
DECLARE @CallerIsDispatch bit               = 1;
DECLARE @From             datetimeoffset(0) = '2026-09-28T00:00:00-05:00';
DECLARE @To               datetimeoffset(0) = '2026-10-05T00:00:00-05:00';
DECLARE @DriverCode       varchar(20)       = 'RDELGADO';
DECLARE @LoadNumber       varchar(20)       = 'L-30450';

-- The window as dock wall-clock time, a day wider each side (see WINDOWS).
DECLARE @FromWall datetime2(0) = DATEADD(day, -1, CAST(@From AS datetime2(0)));
DECLARE @ToWall   datetime2(0) = DATEADD(day,  1, CAST(@To   AS datetime2(0)));

------------------------------------------------------------------------------
-- loadPlanBoard: every active driver; their planned and under-way loads that
-- touch the window; the approved and current stays that touch it.
-- WHO: dispatch only.
------------------------------------------------------------------------------
IF @CallerIsDispatch = 0 THROW 50403, 'Only dispatch sees the load plans.', 1;

SELECT f.Load_Number AS id, f.Plan_State AS status, f.Driver_Code AS driverCode,
       f.Origin AS origin, f.Destination AS destination,
       f.Pickup_Start AS pickupStart, f.Pickup_End AS pickupEnd, f.Delivery_Start AS deliveryStart, f.Delivery_End AS deliveryEnd,
       f.Miles AS miles, f.Rate AS rate, f.Equipment AS equipment, f.Planned_At AS plannedAt
  FROM DRVR.Loads_For_Planning f
 WHERE f.Plan_State IN (N'Covered', N'In Transit')
   AND COALESCE(f.Pickup_Start, f.Pickup_End, f.Delivery_Start) < @ToWall
   AND COALESCE(f.Delivery_End, f.Delivery_Start, f.Pickup_End, f.Pickup_Start) > @FromWall
 ORDER BY f.Driver_Code, CASE f.Plan_State WHEN N'In Transit' THEN 0 ELSE 1 END, f.Pickup_Start;

SELECT d.Driver_Code AS driverCode, CONCAT(d.First_Name, N' ', d.Last_Name) AS name, d.Unit_No AS unitNo,
       CONCAT(d.City, N', ', d.State) AS home
  FROM DRVR.Drivers d
 WHERE ISNULL(d.IsActive, 1) = 1
 ORDER BY d.Driver_Code;

SELECT d.Driver_Code AS driverCode, s.Home_By AS homeBy, s.Back_Out AS backOut, st.Home_Time_Status AS status
  FROM DRVR.Home_Time_Stays s
  JOIN DRVR.Drivers d              ON d.Driver_Id = s.Driver_Id
  JOIN DRVR.fk_Home_Time_Status st ON st.Home_Time_Status_Id = s.Home_Time_Status_Id
 WHERE st.Home_Time_Status IN ('APPROVED', 'HOME') AND ISNULL(s.IsActive, 1) = 1
   AND s.Home_By < @To AND s.Back_Out > @From;

------------------------------------------------------------------------------
-- loadDriverPlan: one driver, their whole plan, their stays -- nobody else's.
-- An unknown driver is nothing at all.
-- WHO: dispatch only.
------------------------------------------------------------------------------
IF @CallerIsDispatch = 0 THROW 50403, 'Only dispatch sees a driver''s plan.', 1;

SELECT f.Load_Number AS id, f.Plan_State AS status, f.Driver_Code AS driverCode,
       f.Origin AS origin, f.Destination AS destination,
       f.Pickup_Start AS pickupStart, f.Pickup_End AS pickupEnd, f.Delivery_Start AS deliveryStart, f.Delivery_End AS deliveryEnd,
       f.Miles AS miles, f.Rate AS rate, f.Equipment AS equipment, f.Planned_At AS plannedAt
  FROM DRVR.Loads_For_Planning f
 WHERE f.Plan_State IN (N'Covered', N'In Transit') AND f.Driver_Code = @DriverCode
 ORDER BY CASE f.Plan_State WHEN N'In Transit' THEN 0 ELSE 1 END, f.Pickup_Start;

SELECT d.Driver_Code AS driverCode, CONCAT(d.First_Name, N' ', d.Last_Name) AS name, d.Unit_No AS unitNo,
       CONCAT(d.City, N', ', d.State) AS home
  FROM DRVR.Drivers d
 WHERE d.Driver_Code = @DriverCode;

SELECT d.Driver_Code AS driverCode, s.Home_By AS homeBy, s.Back_Out AS backOut, st.Home_Time_Status AS status
  FROM DRVR.Home_Time_Stays s
  JOIN DRVR.Drivers d              ON d.Driver_Id = s.Driver_Id
  JOIN DRVR.fk_Home_Time_Status st ON st.Home_Time_Status_Id = s.Home_Time_Status_Id
 WHERE st.Home_Time_Status IN ('APPROVED', 'HOME') AND ISNULL(s.IsActive, 1) = 1
   AND d.Driver_Code = @DriverCode;

------------------------------------------------------------------------------
-- loadOpenLoads: loads on nobody's plan whose pickup window touches the
-- window. Loads only -- no drivers, no stays: a list of work, not of people.
-- WHO: dispatch only.
------------------------------------------------------------------------------
IF @CallerIsDispatch = 0 THROW 50403, 'Only dispatch sees the open loads.', 1;

SELECT f.Load_Number AS id, f.Plan_State AS status, f.Driver_Code AS driverCode,
       f.Origin AS origin, f.Destination AS destination,
       f.Pickup_Start AS pickupStart, f.Pickup_End AS pickupEnd, f.Delivery_Start AS deliveryStart, f.Delivery_End AS deliveryEnd,
       f.Miles AS miles, f.Rate AS rate, f.Equipment AS equipment, f.Planned_At AS plannedAt
  FROM DRVR.Loads_For_Planning f
 WHERE f.Plan_State = N'Available'
   AND COALESCE(f.Pickup_Start, f.Pickup_End) < @ToWall
   AND COALESCE(f.Pickup_End, f.Pickup_Start) >= @FromWall
 ORDER BY COALESCE(f.Pickup_End, f.Pickup_Start), f.Load_Number;

------------------------------------------------------------------------------
-- loadCandidates: the one load, whatever its state now (so the screen can
-- say it was taken meanwhile), and everything ranking drivers for it takes:
-- every active driver, every planned or under-way load, every approved or
-- current stay. An unknown load number is nothing at all.
-- WHO: dispatch only.
------------------------------------------------------------------------------
IF @CallerIsDispatch = 0 THROW 50403, 'Only dispatch finds drivers for a load.', 1;

IF EXISTS (SELECT 1 FROM DRVR.Loads_For_Planning WHERE Load_Number = @LoadNumber)
BEGIN
    SELECT f.Load_Number AS id, f.Plan_State AS status, f.Driver_Code AS driverCode,
           f.Origin AS origin, f.Destination AS destination,
           f.Pickup_Start AS pickupStart, f.Pickup_End AS pickupEnd, f.Delivery_Start AS deliveryStart, f.Delivery_End AS deliveryEnd,
           f.Miles AS miles, f.Rate AS rate, f.Equipment AS equipment, f.Planned_At AS plannedAt
      FROM DRVR.Loads_For_Planning f
     WHERE f.Load_Number = @LoadNumber
        OR f.Plan_State IN (N'Covered', N'In Transit')
     ORDER BY CASE WHEN f.Load_Number = @LoadNumber THEN 0 ELSE 1 END, f.Driver_Code, f.Pickup_Start;

    SELECT d.Driver_Code AS driverCode, CONCAT(d.First_Name, N' ', d.Last_Name) AS name, d.Unit_No AS unitNo,
           CONCAT(d.City, N', ', d.State) AS home
      FROM DRVR.Drivers d
     WHERE ISNULL(d.IsActive, 1) = 1
     ORDER BY d.Driver_Code;

    SELECT d.Driver_Code AS driverCode, s.Home_By AS homeBy, s.Back_Out AS backOut, st.Home_Time_Status AS status
      FROM DRVR.Home_Time_Stays s
      JOIN DRVR.Drivers d              ON d.Driver_Id = s.Driver_Id
      JOIN DRVR.fk_Home_Time_Status st ON st.Home_Time_Status_Id = s.Home_Time_Status_Id
     WHERE st.Home_Time_Status IN ('APPROVED', 'HOME') AND ISNULL(s.IsActive, 1) = 1;
END
