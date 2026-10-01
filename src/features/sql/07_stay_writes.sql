------------------------------------------------------------------------------
-- 07_stay_writes.sql -- the Driver Home Time Schedule's two writes, as the
-- server stores them, each with WHO may make it written into it.
--
-- NOT A SETUP SCRIPT. These are the API's statements, runnable here to try.
-- TRYING CHANGES NOTHING: the whole file runs in one transaction that is
-- rolled back at the end, unless @Keep is set to 1. Pick ONE with @Do.
--
-- THE SPLIT. The schedule's rules live in home-time-schedule/rules.ts, and
-- the API runs them -- as the preview does -- before anything is stored:
--   request  checkNewStay(request, that driver's stays) must find nothing;
--   store    applyAction(stay, action) gives the stay as it is after a move.
-- This file stores what they decided. It still refuses what the database
-- itself can know: a move by someone not allowed it, a driver asking for
-- someone else, and a stay that changed between the API reading it and
-- storing it (@ExpectStatus).
--
-- WHO. The API fills @CallerUuid and @CallerIsDispatch from the session,
-- never from the request body. A driver is matched to their user by
-- DRVR.Drivers.User_Uuid.
--   request  the driver, for themselves.
--   store    dispatch, any move; a driver, only cancelling their own stay.
--
-- HISTORY. Each write also adds a row to DRVR.Home_Time_Stay_History
-- (08_DRVR_Home_Time_Stay_History.sql), in the same transaction: the stay as
-- the move left it, who moved it, and from which status. A move is never
-- stored without its history row, nor the other way round.
--
-- Answers with the stay as stored after, in 03_scoped_reads.sql's columns.
------------------------------------------------------------------------------
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET XACT_ABORT ON;   -- a refusal rolls the whole transaction back

-- Try it.
DECLARE @CallerUuid       uniqueidentifier  = NULL;
DECLARE @CallerIsDispatch bit               = 1;
DECLARE @Do               varchar(10)       = 'store';    -- 'request' or 'store'
DECLARE @Keep             bit               = 0;          -- 1 to keep the change
-- request:
DECLARE @DriverCode       varchar(20)       = 'TBOONE';
DECLARE @HomeBy           datetimeoffset(0) = '2026-10-09T18:00:00-05:00';
DECLARE @BackOut          datetimeoffset(0) = '2026-10-12T06:00:00-05:00';
DECLARE @Note             nvarchar(500)     = NULL;
-- store (the stay after applyAction):
DECLARE @StayId           int               = 1;
DECLARE @ExpectStatus     varchar(20)       = 'REQUESTED';  -- as it was when the API read it
DECLARE @Status           varchar(20)       = 'APPROVED';
DECLARE @DecidedAt        datetimeoffset(0) = NULL;
DECLARE @DeclineReason    nvarchar(500)     = NULL;
DECLARE @ArrivedAt        datetimeoffset(0) = NULL;
DECLARE @ArrivedSource    varchar(20)       = NULL;
DECLARE @LeftAt           datetimeoffset(0) = NULL;
DECLARE @LeftSource       varchar(20)       = NULL;

DECLARE @msg nvarchar(400), @DriverId int, @StatusId int, @ArrivedSourceId int, @LeftSourceId int, @Was varchar(20), @WasId int, @Owner uniqueidentifier;

BEGIN TRANSACTION;

------------------------------------------------------------------------------
-- requestStay: a driver asks. rules.ts: checkNewStay, run by the API first.
------------------------------------------------------------------------------
IF @Do = 'request'
BEGIN
    SELECT @DriverId = Driver_Id, @Owner = User_Uuid FROM DRVR.Drivers WHERE Driver_Code = @DriverCode AND ISNULL(IsActive, 1) = 1;
    IF @DriverId IS NULL BEGIN SET @msg = CONCAT(N'There is no driver ', @DriverCode, N'.'); THROW 50404, @msg, 1; END;
    IF @CallerIsDispatch = 0 AND (@Owner IS NULL OR @Owner <> @CallerUuid)
        THROW 50403, 'A driver asks for their own home time only.', 1;
    SET @StatusId = (SELECT Home_Time_Status_Id FROM DRVR.fk_Home_Time_Status WHERE Home_Time_Status = 'REQUESTED');
    INSERT DRVR.Home_Time_Stays (Driver_Id, Home_Time_Status_Id, Home_By, Back_Out, Note, Created_By)
    VALUES (@DriverId, @StatusId, @HomeBy, @BackOut, @Note, @CallerUuid);
    SET @StayId = SCOPE_IDENTITY();

    INSERT DRVR.Home_Time_Stay_History (Home_Time_Stay_Id, From_Status_Id, To_Status_Id, Moved_By, Created_By)
    VALUES (@StayId, NULL, @StatusId, @CallerUuid, @CallerUuid);
END
------------------------------------------------------------------------------
-- actOnStay: store the stay as applyAction left it.
------------------------------------------------------------------------------
ELSE IF @Do = 'store'
BEGIN
    SELECT @Was = st.Home_Time_Status, @WasId = st.Home_Time_Status_Id, @Owner = d.User_Uuid
      FROM DRVR.Home_Time_Stays s
      JOIN DRVR.fk_Home_Time_Status st ON st.Home_Time_Status_Id = s.Home_Time_Status_Id
      JOIN DRVR.Drivers d ON d.Driver_Id = s.Driver_Id
     WHERE s.Home_Time_Stay_Id = @StayId;
    IF @Was IS NULL THROW 50404, 'That stay no longer exists.', 1;
    IF @CallerIsDispatch = 0 AND NOT (@Status = 'CANCELLED' AND @Owner = @CallerUuid)
        THROW 50403, 'A driver may only cancel their own stay.', 1;
    IF @Was <> @ExpectStatus
    BEGIN
        SET @msg = CONCAT(N'That stay is ', @Was, N' now, not ', @ExpectStatus, N' -- someone moved it meanwhile. Look again.');
        THROW 50409, @msg, 1;
    END;

    SET @StatusId        = (SELECT Home_Time_Status_Id FROM DRVR.fk_Home_Time_Status WHERE Home_Time_Status = @Status);
    SET @ArrivedSourceId = (SELECT Home_Time_Source_Id FROM DRVR.fk_Home_Time_Source WHERE Home_Time_Source = @ArrivedSource);
    SET @LeftSourceId    = (SELECT Home_Time_Source_Id FROM DRVR.fk_Home_Time_Source WHERE Home_Time_Source = @LeftSource);
    IF @StatusId IS NULL BEGIN SET @msg = CONCAT(N'"', @Status, N'" is not a row of DRVR.fk_Home_Time_Status.'); THROW 50400, @msg, 1; END;
    IF (@ArrivedSource IS NOT NULL AND @ArrivedSourceId IS NULL) OR (@LeftSource IS NOT NULL AND @LeftSourceId IS NULL)
        THROW 50400, 'A source is not a row of DRVR.fk_Home_Time_Source.', 1;

    -- Decided_By is the caller when this move records a new decision (in
    -- rules.ts only approve and decline set decidedAt), and stays as it was
    -- otherwise: arriving, leaving and correcting decide nothing.
    UPDATE DRVR.Home_Time_Stays
       SET Home_Time_Status_Id = @StatusId,
           Decided_At        = @DecidedAt,
           Decided_By        = CASE WHEN @DecidedAt IS NOT NULL AND (Decided_At IS NULL OR Decided_At <> @DecidedAt) THEN @CallerUuid ELSE Decided_By END,
           Decline_Reason    = @DeclineReason,
           Arrived_At        = @ArrivedAt,
           Arrived_Source_Id = @ArrivedSourceId,
           Left_At           = @LeftAt,
           Left_Source_Id    = @LeftSourceId,
           Updated_At        = getdate()
     WHERE Home_Time_Stay_Id = @StayId;

    INSERT DRVR.Home_Time_Stay_History (Home_Time_Stay_Id, From_Status_Id, To_Status_Id, Moved_By,
                                        Decline_Reason, Arrived_At, Arrived_Source_Id, Left_At, Left_Source_Id, Created_By)
    VALUES (@StayId, @WasId, @StatusId, @CallerUuid,
            @DeclineReason, @ArrivedAt, @ArrivedSourceId, @LeftAt, @LeftSourceId, @CallerUuid);
END
ELSE THROW 50400, '@Do must be request or store.', 1;

-- The stay as stored after.
SELECT CAST(s.Home_Time_Stay_Id AS varchar(20)) AS id, d.Driver_Code AS driverCode, st.Home_Time_Status AS status,
       s.Home_By AS homeBy, s.Back_Out AS backOut, s.Note AS note, s.Requested_At AS requestedAt,
       s.Decided_At AS decidedAt, s.Decided_By AS decidedByUser, s.Decline_Reason AS declineReason,
       s.Arrived_At AS arrivedAt, sa.Home_Time_Source AS arrivedSource, s.Left_At AS leftAt, sl.Home_Time_Source AS leftSource
  FROM DRVR.Home_Time_Stays s
  JOIN DRVR.Drivers d               ON d.Driver_Id = s.Driver_Id
  JOIN DRVR.fk_Home_Time_Status st  ON st.Home_Time_Status_Id = s.Home_Time_Status_Id
  LEFT JOIN DRVR.fk_Home_Time_Source sa ON sa.Home_Time_Source_Id = s.Arrived_Source_Id
  LEFT JOIN DRVR.fk_Home_Time_Source sl ON sl.Home_Time_Source_Id = s.Left_Source_Id
 WHERE s.Home_Time_Stay_Id = @StayId;

IF @Keep = 1 COMMIT TRANSACTION;
ELSE BEGIN ROLLBACK TRANSACTION; PRINT 'Tried, and rolled back. Set @Keep = 1 to keep it.'; END;
