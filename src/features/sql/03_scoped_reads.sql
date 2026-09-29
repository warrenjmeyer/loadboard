------------------------------------------------------------------------------
-- 03_scoped_reads.sql -- the four reads the schedule makes, as the server
-- runs them, each with WHO may make it written into it.
--
-- NOT A SETUP SCRIPT. These are the API's queries, runnable here one at a
-- time with the parameters below, to see what each returns before any API
-- code exists. They answer exactly as home-time-schedule/scope.ts does, and
-- scope.test.ts is the list of what that means.
--
-- WHO. Scoping keeps a screen from ASKING for other drivers' stays; these
-- checks keep a hand-written request from GETTING them. The API fills the two
-- caller parameters from the session -- never from the request body:
--   @CallerUuid        the signed-in user
--   @CallerIsDispatch  1 for dispatch or admin
-- A driver is matched to their user by DRVR.Drivers.User_Uuid. A driver
-- asking about anyone else is REFUSED (THROW), not answered with an empty
-- list -- an empty answer would say "no stays" about someone who has some.
--
-- SHAPE. Each read returns two result sets, stays then drivers, with the
-- columns named as contract.ts names them, so the API hands them over as
-- they come. Statuses are joined by NAME. Sources come back as Ids
-- (arrivedSourceId, leftSourceId): the API maps them to 'geotab'/'dispatch'
-- through DRVR.fk_Home_Time_Source by name, as it does statuses -- so these
-- queries run whether or not that table exists yet.
------------------------------------------------------------------------------
SET NOCOUNT ON;
-- Filtered indexes (UX_Drivers_User_Uuid) need these ON to be created, and to
-- insert or update the table afterwards. SSMS turns them on by default;
-- sqlcmd and some older drivers do not, so they are set here, not assumed.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

-- Try it: set these, then run ONE of the reads below.
DECLARE @CallerUuid       uniqueidentifier = NULL;
DECLARE @CallerIsDispatch bit              = 1;
DECLARE @DriverCode       varchar(20)      = 'TBOONE';
DECLARE @StayId           int              = 1;
DECLARE @From             datetimeoffset(0) = '2026-09-25T00:00:00-05:00';
DECLARE @To               datetimeoffset(0) = '2026-10-09T00:00:00-05:00';

------------------------------------------------------------------------------
-- loadQueue: requests waiting on dispatch, oldest first, and their drivers.
-- WHO: dispatch only.
------------------------------------------------------------------------------
IF @CallerIsDispatch = 0 THROW 50403, 'Only dispatch sees the queue.', 1;

SELECT CAST(s.Home_Time_Stay_Id AS varchar(20)) AS id, d.Driver_Code AS driverCode, st.Home_Time_Status AS status,
       s.Home_By AS homeBy, s.Back_Out AS backOut, s.Note AS note, s.Requested_At AS requestedAt,
       s.Decided_At AS decidedAt, s.Decided_By AS decidedByUser, s.Decline_Reason AS declineReason,
       s.Arrived_At AS arrivedAt, s.Arrived_Source_Id AS arrivedSourceId, s.Left_At AS leftAt, s.Left_Source_Id AS leftSourceId
  FROM DRVR.Home_Time_Stays s
  JOIN DRVR.Drivers d               ON d.Driver_Id = s.Driver_Id
  JOIN DRVR.fk_Home_Time_Status st  ON st.Home_Time_Status_Id = s.Home_Time_Status_Id
 WHERE st.Home_Time_Status = 'REQUESTED' AND ISNULL(s.IsActive, 1) = 1
 ORDER BY s.Requested_At;

SELECT d.Driver_Code AS driverCode, CONCAT(d.First_Name, ' ', d.Last_Name) AS name, d.Unit_No AS unitNo, lh.lastHomeAt
  FROM DRVR.Drivers d
 OUTER APPLY (
       -- Home now: out zero days. Otherwise: when they last LEFT home.
       SELECT CASE WHEN EXISTS (SELECT 1 FROM DRVR.Home_Time_Stays h JOIN DRVR.fk_Home_Time_Status hs ON hs.Home_Time_Status_Id = h.Home_Time_Status_Id
                                 WHERE h.Driver_Id = d.Driver_Id AND hs.Home_Time_Status = 'HOME')
                   THEN SYSDATETIMEOFFSET()
                   ELSE (SELECT MAX(h.Left_At) FROM DRVR.Home_Time_Stays h JOIN DRVR.fk_Home_Time_Status hs ON hs.Home_Time_Status_Id = h.Home_Time_Status_Id
                          WHERE h.Driver_Id = d.Driver_Id AND hs.Home_Time_Status = 'DONE') END AS lastHomeAt
     ) lh
 WHERE d.Driver_Id IN (SELECT s.Driver_Id FROM DRVR.Home_Time_Stays s JOIN DRVR.fk_Home_Time_Status st ON st.Home_Time_Status_Id = s.Home_Time_Status_Id
                        WHERE st.Home_Time_Status = 'REQUESTED' AND ISNULL(s.IsActive, 1) = 1);

------------------------------------------------------------------------------
-- loadBoard: every active driver, and the stays that occupy [@From, @To).
-- A stay occupies the board from when it began (arrived, or home-by) to when
-- it ended (left, or back-out). DECLINED and CANCELLED never occupy it.
-- WHO: dispatch only -- the board is every driver's home time.
------------------------------------------------------------------------------
IF @CallerIsDispatch = 0 THROW 50403, 'Only dispatch sees the board.', 1;

SELECT CAST(s.Home_Time_Stay_Id AS varchar(20)) AS id, d.Driver_Code AS driverCode, st.Home_Time_Status AS status,
       s.Home_By AS homeBy, s.Back_Out AS backOut, s.Note AS note, s.Requested_At AS requestedAt,
       s.Decided_At AS decidedAt, s.Decided_By AS decidedByUser, s.Decline_Reason AS declineReason,
       s.Arrived_At AS arrivedAt, s.Arrived_Source_Id AS arrivedSourceId, s.Left_At AS leftAt, s.Left_Source_Id AS leftSourceId
  FROM DRVR.Home_Time_Stays s
  JOIN DRVR.Drivers d               ON d.Driver_Id = s.Driver_Id
  JOIN DRVR.fk_Home_Time_Status st  ON st.Home_Time_Status_Id = s.Home_Time_Status_Id
 WHERE st.Home_Time_Status IN ('REQUESTED', 'APPROVED', 'HOME', 'DONE') AND ISNULL(s.IsActive, 1) = 1
   AND COALESCE(s.Arrived_At, s.Home_By) < @To
   AND COALESCE(s.Left_At, s.Back_Out)  > @From;

SELECT d.Driver_Code AS driverCode, CONCAT(d.First_Name, ' ', d.Last_Name) AS name, d.Unit_No AS unitNo, lh.lastHomeAt
  FROM DRVR.Drivers d
 OUTER APPLY (
       SELECT CASE WHEN EXISTS (SELECT 1 FROM DRVR.Home_Time_Stays h JOIN DRVR.fk_Home_Time_Status hs ON hs.Home_Time_Status_Id = h.Home_Time_Status_Id
                                 WHERE h.Driver_Id = d.Driver_Id AND hs.Home_Time_Status = 'HOME')
                   THEN SYSDATETIMEOFFSET()
                   ELSE (SELECT MAX(h.Left_At) FROM DRVR.Home_Time_Stays h JOIN DRVR.fk_Home_Time_Status hs ON hs.Home_Time_Status_Id = h.Home_Time_Status_Id
                          WHERE h.Driver_Id = d.Driver_Id AND hs.Home_Time_Status = 'DONE') END AS lastHomeAt
     ) lh
 WHERE ISNULL(d.IsActive, 1) = 1;

------------------------------------------------------------------------------
-- loadDriverStays: one driver and their stays -- nobody else's.
-- WHO: dispatch, or THAT driver.
------------------------------------------------------------------------------
IF @CallerIsDispatch = 0
   AND NOT EXISTS (SELECT 1 FROM DRVR.Drivers WHERE Driver_Code = @DriverCode AND User_Uuid = @CallerUuid)
    THROW 50403, 'Those are not your stays.', 1;

SELECT CAST(s.Home_Time_Stay_Id AS varchar(20)) AS id, d.Driver_Code AS driverCode, st.Home_Time_Status AS status,
       s.Home_By AS homeBy, s.Back_Out AS backOut, s.Note AS note, s.Requested_At AS requestedAt,
       s.Decided_At AS decidedAt, s.Decided_By AS decidedByUser, s.Decline_Reason AS declineReason,
       s.Arrived_At AS arrivedAt, s.Arrived_Source_Id AS arrivedSourceId, s.Left_At AS leftAt, s.Left_Source_Id AS leftSourceId
  FROM DRVR.Home_Time_Stays s
  JOIN DRVR.Drivers d               ON d.Driver_Id = s.Driver_Id
  JOIN DRVR.fk_Home_Time_Status st  ON st.Home_Time_Status_Id = s.Home_Time_Status_Id
 WHERE d.Driver_Code = @DriverCode AND ISNULL(s.IsActive, 1) = 1
 ORDER BY s.Home_By DESC;

SELECT d.Driver_Code AS driverCode, CONCAT(d.First_Name, ' ', d.Last_Name) AS name, d.Unit_No AS unitNo, lh.lastHomeAt
  FROM DRVR.Drivers d
 OUTER APPLY (
       SELECT CASE WHEN EXISTS (SELECT 1 FROM DRVR.Home_Time_Stays h JOIN DRVR.fk_Home_Time_Status hs ON hs.Home_Time_Status_Id = h.Home_Time_Status_Id
                                 WHERE h.Driver_Id = d.Driver_Id AND hs.Home_Time_Status = 'HOME')
                   THEN SYSDATETIMEOFFSET()
                   ELSE (SELECT MAX(h.Left_At) FROM DRVR.Home_Time_Stays h JOIN DRVR.fk_Home_Time_Status hs ON hs.Home_Time_Status_Id = h.Home_Time_Status_Id
                          WHERE h.Driver_Id = d.Driver_Id AND hs.Home_Time_Status = 'DONE') END AS lastHomeAt
     ) lh
 WHERE d.Driver_Code = @DriverCode;

------------------------------------------------------------------------------
-- loadStay: one stay and its driver; nothing when there is no such stay.
-- WHO: dispatch, or the driver whose stay it is.
------------------------------------------------------------------------------
IF @CallerIsDispatch = 0
   AND EXISTS (SELECT 1 FROM DRVR.Home_Time_Stays WHERE Home_Time_Stay_Id = @StayId)
   AND NOT EXISTS (SELECT 1 FROM DRVR.Home_Time_Stays s JOIN DRVR.Drivers d ON d.Driver_Id = s.Driver_Id
                    WHERE s.Home_Time_Stay_Id = @StayId AND d.User_Uuid = @CallerUuid)
    THROW 50403, 'That is not your stay.', 1;

SELECT CAST(s.Home_Time_Stay_Id AS varchar(20)) AS id, d.Driver_Code AS driverCode, st.Home_Time_Status AS status,
       s.Home_By AS homeBy, s.Back_Out AS backOut, s.Note AS note, s.Requested_At AS requestedAt,
       s.Decided_At AS decidedAt, s.Decided_By AS decidedByUser, s.Decline_Reason AS declineReason,
       s.Arrived_At AS arrivedAt, s.Arrived_Source_Id AS arrivedSourceId, s.Left_At AS leftAt, s.Left_Source_Id AS leftSourceId
  FROM DRVR.Home_Time_Stays s
  JOIN DRVR.Drivers d               ON d.Driver_Id = s.Driver_Id
  JOIN DRVR.fk_Home_Time_Status st  ON st.Home_Time_Status_Id = s.Home_Time_Status_Id
 WHERE s.Home_Time_Stay_Id = @StayId;

SELECT d.Driver_Code AS driverCode, CONCAT(d.First_Name, ' ', d.Last_Name) AS name, d.Unit_No AS unitNo, lh.lastHomeAt
  FROM DRVR.Drivers d
  JOIN DRVR.Home_Time_Stays s ON s.Driver_Id = d.Driver_Id AND s.Home_Time_Stay_Id = @StayId
 OUTER APPLY (
       SELECT CASE WHEN EXISTS (SELECT 1 FROM DRVR.Home_Time_Stays h JOIN DRVR.fk_Home_Time_Status hs ON hs.Home_Time_Status_Id = h.Home_Time_Status_Id
                                 WHERE h.Driver_Id = d.Driver_Id AND hs.Home_Time_Status = 'HOME')
                   THEN SYSDATETIMEOFFSET()
                   ELSE (SELECT MAX(h.Left_At) FROM DRVR.Home_Time_Stays h JOIN DRVR.fk_Home_Time_Status hs ON hs.Home_Time_Status_Id = h.Home_Time_Status_Id
                          WHERE h.Driver_Id = d.Driver_Id AND hs.Home_Time_Status = 'DONE') END AS lastHomeAt
     ) lh;
