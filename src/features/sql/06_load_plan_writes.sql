------------------------------------------------------------------------------
-- 06_load_plan_writes.sql -- the tab's two writes, Assign and Take back, as
-- the server runs them, each with WHO may make it written into it.
--
-- NOT A SETUP SCRIPT. These are the API's statements, runnable here to try.
-- TRYING CHANGES NOTHING: the whole file runs in one transaction that is
-- rolled back at the end, unless @Keep is set to 1. Pick ONE of the two
-- with @Do.
--
-- They refuse what rules.ts refuses, IN THE SAME WORDS, because the screen
-- shows the server's sentence as it comes:
--   assign    "L-30418 is Covered with RDELGADO now, not Available."
--   unassign  "L-30412 is already under way; it cannot come off the plan."
--             "L-30450 is not on anyone's plan."
--
-- WHO: dispatch only (THROW 50403). The API fills @CallerUuid and
-- @CallerIsDispatch from the session, never from the request body; the
-- caller is recorded as Planned_By or Taken_Back_By.
--
-- RACES. Two dispatchers clicking Assign on one load at once: both pass the
-- "is it Available" check, and the unique index on current plans
-- (04_DRVR_Load_Plans.sql) refuses the second INSERT. That refusal is caught
-- and answered with the same sentence, naming who got it.
--
-- Answers with the load as stored after (one row, contract.ts's names).
------------------------------------------------------------------------------
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET XACT_ABORT ON;   -- a refusal rolls the whole transaction back

-- Try it.
DECLARE @CallerUuid       uniqueidentifier = NULL;
DECLARE @CallerIsDispatch bit              = 1;
DECLARE @Do               varchar(10)      = 'assign';   -- 'assign' or 'unassign'
DECLARE @LoadNumber       varchar(20)      = 'L-30450';
DECLARE @DriverCode       varchar(20)      = 'SOAKS';    -- assign only
DECLARE @Keep             bit              = 0;          -- 1 to keep the change

DECLARE @Planned   int = (SELECT Load_Plan_Status_Id FROM DRVR.fk_Load_Plan_Status WHERE Load_Plan_Status = 'PLANNED');
DECLARE @TakenBack int = (SELECT Load_Plan_Status_Id FROM DRVR.fk_Load_Plan_Status WHERE Load_Plan_Status = 'TAKEN_BACK');
DECLARE @msg nvarchar(400), @n int, @LoadUuid uniqueidentifier, @State nvarchar(20), @Holder varchar(20), @DriverId int;

BEGIN TRANSACTION;

IF @CallerIsDispatch = 0 THROW 50403, 'Only dispatch puts loads on plans and takes them off.', 1;

-- The load, by the number the screen shows. A number that is not there, or
-- -- since TMS.Loads does not promise it -- is there twice, is refused.
SELECT @n = COUNT(*) FROM DRVR.Loads_For_Planning WHERE Load_Number = @LoadNumber;
IF @n = 0 BEGIN SET @msg = CONCAT(@LoadNumber, N' no longer exists.'); THROW 50404, @msg, 1; END;
IF @n > 1 BEGIN SET @msg = CONCAT(N'More than one load is numbered ', @LoadNumber, N'; plan it by hand.'); THROW 50409, @msg, 1; END;
SELECT @LoadUuid = Load_Uuid, @State = Plan_State, @Holder = Driver_Code FROM DRVR.Loads_For_Planning WHERE Load_Number = @LoadNumber;

------------------------------------------------------------------------------
-- assignLoad: put an Available load on a driver's plan. rules.ts: assign.
------------------------------------------------------------------------------
IF @Do = 'assign'
BEGIN
    SET @DriverId = (SELECT Driver_Id FROM DRVR.Drivers WHERE Driver_Code = @DriverCode AND ISNULL(IsActive, 1) = 1);
    IF @DriverId IS NULL BEGIN SET @msg = CONCAT(N'There is no driver ', @DriverCode, N'.'); THROW 50404, @msg, 1; END;
    IF @State <> N'Available'
    BEGIN
        SET @msg = CONCAT(@LoadNumber, N' is ', @State, CASE WHEN @Holder IS NULL THEN N'' ELSE CONCAT(N' with ', @Holder) END, N' now, not Available.');
        THROW 50409, @msg, 1;
    END;
    BEGIN TRY
        INSERT DRVR.Load_Plans (Load_Uuid, Driver_Id, Load_Plan_Status_Id, Planned_By, Created_By)
        VALUES (@LoadUuid, @DriverId, @Planned, @CallerUuid, @CallerUuid);
    END TRY
    BEGIN CATCH
        -- 2601: the unique index on current plans. Someone planned it a
        -- moment ago; say who, in the same words as the check above.
        IF ERROR_NUMBER() = 2601
        BEGIN
            ROLLBACK TRANSACTION;
            SELECT @State = Plan_State, @Holder = Driver_Code FROM DRVR.Loads_For_Planning WHERE Load_Uuid = @LoadUuid;
            SET @msg = CONCAT(@LoadNumber, N' is ', @State, CASE WHEN @Holder IS NULL THEN N'' ELSE CONCAT(N' with ', @Holder) END, N' now, not Available.');
            THROW 50409, @msg, 1;
        END;
        THROW;
    END CATCH;
END
------------------------------------------------------------------------------
-- unassignLoad: take a planned load back off. rules.ts: unassign. The row
-- stays, marked TAKEN_BACK, with who and when.
------------------------------------------------------------------------------
ELSE IF @Do = 'unassign'
BEGIN
    IF @State = N'In Transit' BEGIN SET @msg = CONCAT(@LoadNumber, N' is already under way; it cannot come off the plan.'); THROW 50409, @msg, 1; END;
    IF @State <> N'Covered'   BEGIN SET @msg = CONCAT(@LoadNumber, N' is not on anyone''s plan.'); THROW 50409, @msg, 1; END;
    UPDATE DRVR.Load_Plans
       SET Load_Plan_Status_Id = @TakenBack, Taken_Back_At = SYSDATETIMEOFFSET(), Taken_Back_By = @CallerUuid, Updated_At = getdate()
     WHERE Load_Uuid = @LoadUuid AND Taken_Back_At IS NULL;
    -- Nothing changed: someone took it back a moment ago.
    IF @@ROWCOUNT = 0 BEGIN SET @msg = CONCAT(@LoadNumber, N' is not on anyone''s plan.'); THROW 50409, @msg, 1; END;
END
ELSE THROW 50400, '@Do must be assign or unassign.', 1;

-- The load as stored after.
SELECT f.Load_Number AS id, f.Plan_State AS status, f.Driver_Code AS driverCode,
       f.Origin AS origin, f.Destination AS destination,
       f.Pickup_Start AS pickupStart, f.Pickup_End AS pickupEnd, f.Delivery_Start AS deliveryStart, f.Delivery_End AS deliveryEnd,
       f.Miles AS miles, f.Rate AS rate, f.Equipment AS equipment, f.Planned_At AS plannedAt
  FROM DRVR.Loads_For_Planning f
 WHERE f.Load_Uuid = @LoadUuid;

IF @Keep = 1 COMMIT TRANSACTION;
ELSE BEGIN ROLLBACK TRANSACTION; PRINT 'Tried, and rolled back. Set @Keep = 1 to keep it.'; END;
