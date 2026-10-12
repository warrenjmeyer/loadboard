------------------------------------------------------------------------------
-- 10_driver_writes.sql -- the Driver Master tab's three writes, as the
-- server runs them, each with WHO may make it written into it:
--   save    change a driver                       dispatch or admin
--   add     a new driver                          admin
--   active  a driver leaves (0) or comes back (1) dispatch or admin
--
-- NOT A SETUP SCRIPT. These are the API's statements, runnable here to try.
-- TRYING CHANGES NOTHING: the whole file runs in one transaction that is
-- rolled back at the end, unless @Keep is set to 1. Pick ONE with @Do.
--
-- THE API WORKS OUT THE DRIVER FIRST, as it does a stay's move (07): it
-- reads the driver (09's loadDriver, as the caller), runs the change through
-- driver-master/rules.ts (applyChanges, or checkNewDriver for an add), and
-- passes the driver as it should be stored -- every detail field, not only
-- the changed ones. This stores it, after checking again what must not be
-- left to the API: who, the version, the code, and pay.
--
-- WHO. The API fills @CallerUuid, @CallerIsDispatch and @CallerIsAdmin from
-- the session, never from the request body. Pay -- @DriverType, @SsnLast4,
-- @PayRate, @PayFrequency, @PayBasis, @PayGroup -- is admin's: for anyone
-- else the API passes them all NULL, and this refuses if it does not.
-- Refusals are in rules.ts's words, because the screen shows them as they
-- come:
--   "TBOONE was changed by someone else since you opened it. Close it and
--    open it again to see what changed."
--   "Only an admin changes pay, the SSN or the driver type."
--   "TBOONE is taken. Codes are never reused, even for a driver who has left."
--
-- NEVER TOUCHED HERE: Driver_Id, User_Uuid (linking a sign-in is the app's
-- own business), Created_At, Created_By after an add, j, TTP_ID.
--
-- Answers with the driver as stored after: 09's loadDriver columns, pay
-- included only for an admin.
------------------------------------------------------------------------------
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET XACT_ABORT ON;   -- a refusal rolls the whole transaction back

-- Try it. The values are the laptop's TBOONE, moved to Waterloo.
DECLARE @CallerUuid       uniqueidentifier = NULL;
DECLARE @CallerIsDispatch bit              = 1;
DECLARE @CallerIsAdmin    bit              = 0;
DECLARE @Do               varchar(10)      = 'save';     -- 'save', 'add' or 'active'
DECLARE @DriverCode       varchar(20)      = 'TBOONE';
DECLARE @Version          varchar(23)      = NULL;       -- save and active: the version read; NULL here takes the current one, to try
DECLARE @Active           bit              = 1;          -- active only
DECLARE @FirstName        nvarchar(50)     = N'Terrell';
DECLARE @LastName         nvarchar(50)     = N'Boone';
DECLARE @Address1         nvarchar(100)    = N'1214 Lafayette Street';
DECLARE @Address2         nvarchar(100)    = NULL;
DECLARE @City             nvarchar(60)     = N'Waterloo';
DECLARE @State            nchar(2)         = N'IA';
DECLARE @PostalCode       varchar(10)      = '50703';
DECLARE @Country          nvarchar(40)     = N'USA';
DECLARE @Job              nvarchar(60)     = N'OTR Driver';
DECLARE @JobType          nvarchar(60)     = N'Company Driver';
DECLARE @Location         nvarchar(60)     = N'Dubuque, IA';
DECLARE @Department       nvarchar(60)     = N'Linehaul';
DECLARE @UnitNo           varchar(20)      = 'Demo - 02';
DECLARE @TruckDescription nvarchar(80)     = N'2020 Volvo VNL 760';
DECLARE @DriverType       varchar(10)      = NULL;       -- admin only, from here down
DECLARE @SsnLast4         char(4)          = NULL;
DECLARE @PayRate          decimal(9,4)     = NULL;
DECLARE @PayFrequency     char(1)          = NULL;
DECLARE @PayBasis         varchar(12)      = NULL;
DECLARE @PayGroup         nvarchar(20)     = NULL;
DECLARE @Keep             bit              = 0;          -- 1 to keep the change

DECLARE @msg nvarchar(400), @Current varchar(23), @n int;
DECLARE @PayGiven bit = CASE WHEN COALESCE(@DriverType, @SsnLast4, @PayFrequency, @PayBasis, @PayGroup) IS NOT NULL OR @PayRate IS NOT NULL THEN 1 ELSE 0 END;

BEGIN TRANSACTION;

IF @CallerIsDispatch = 0 AND @CallerIsAdmin = 0 THROW 50403, 'Only dispatch and admin keep the driver master.', 1;
IF @PayGiven = 1 AND @CallerIsAdmin = 0 THROW 50403, 'Only an admin changes pay, the SSN or the driver type.', 1;

------------------------------------------------------------------------------
-- add: a new driver, complete. rules.ts: checkNewDriver. WHO: admin.
------------------------------------------------------------------------------
IF @Do = 'add'
BEGIN
    IF @CallerIsAdmin = 0 THROW 50403, 'Only an admin adds drivers.', 1;
    IF @DriverCode IS NULL OR @DriverCode NOT LIKE '[A-Z0-9][A-Z0-9]%' OR @DriverCode LIKE '%[^A-Z0-9]%'
        THROW 50400, 'A driver code is 2 to 20 letters and digits: TBOONE.', 1;
    IF @PayGiven = 0 OR @DriverType IS NULL OR @SsnLast4 IS NULL OR @PayRate IS NULL OR @PayFrequency IS NULL OR @PayGroup IS NULL
        THROW 50400, 'A new driver needs their pay: driver type, SSN last four, rate, frequency and pay group.', 1;
    IF EXISTS (SELECT 1 FROM DRVR.Drivers WHERE Driver_Code = @DriverCode)
    BEGIN SET @msg = CONCAT(@DriverCode, N' is taken. Codes are never reused, even for a driver who has left.'); THROW 50409, @msg, 1; END;
END
------------------------------------------------------------------------------
-- save and active: the driver must be there, unchanged since it was read.
------------------------------------------------------------------------------
ELSE IF @Do IN ('save', 'active')
BEGIN
    SELECT @n = COUNT(*), @Current = MAX(COALESCE(CONVERT(varchar(23), Updated_At, 121), 'none'))
      FROM DRVR.Drivers WITH (UPDLOCK, HOLDLOCK) WHERE Driver_Code = @DriverCode;
    IF @n = 0 BEGIN SET @msg = CONCAT(N'There is no driver ', @DriverCode, N'.'); THROW 50404, @msg, 1; END;
    SET @Version = COALESCE(@Version, @Current);   -- trying it by hand
    IF @Version <> @Current
    BEGIN SET @msg = CONCAT(@DriverCode, N' was changed by someone else since you opened it. Close it and open it again to see what changed.'); THROW 50409, @msg, 1; END;
END
ELSE THROW 50400, '@Do must be save, add or active.', 1;

------------------------------------------------------------------------------
-- What must hold of what is stored, whoever worked it out: an owner has a
-- pay basis and a company driver none (the load board's CK_Drivers_paybasis),
-- the SSN is four digits, the rate is not below zero.
------------------------------------------------------------------------------
IF @PayGiven = 1
BEGIN
    DECLARE @TypeAfter varchar(10) = COALESCE(@DriverType, (SELECT Driver_Type FROM DRVR.Drivers WHERE Driver_Code = @DriverCode));
    IF @TypeAfter NOT IN ('COMPANY', 'OWNER') THROW 50400, 'Choose company driver or owner/operator.', 1;
    IF @TypeAfter = 'OWNER' AND (@PayBasis IS NULL OR @PayBasis NOT IN ('MILEAGE', 'PERCENTAGE'))
        THROW 50400, 'An owner/operator is paid by the mile or by a share of the linehaul. Choose one.', 1;
    IF @TypeAfter = 'COMPANY' AND @PayBasis IS NOT NULL THROW 50400, 'A company driver has no pay basis.', 1;
    IF @SsnLast4 IS NULL OR @SsnLast4 LIKE '%[^0-9]%' OR LEN(@SsnLast4) <> 4 THROW 50400, 'The last four digits of their SSN: four digits, no more.', 1;
    IF @PayRate IS NULL OR @PayRate < 0 THROW 50400, 'Pay rate cannot be below zero.', 1;
    IF @PayFrequency IS NULL OR @PayFrequency NOT IN ('W', 'B', 'S', 'M') THROW 50400, 'Choose how often they are paid.', 1;
    IF NULLIF(LTRIM(RTRIM(@PayGroup)), N'') IS NULL THROW 50400, 'Pay group is needed.', 1;
END

IF @Do = 'add'
BEGIN
    INSERT DRVR.Drivers (Driver_Code, First_Name, Last_Name, Address1, Address2, City, State, Postal_Code, Country,
                         SSN_Last4, Job, Pay_Rate, Pay_Frequency, Pay_Group, Location, Department, Job_Type, Driver_Type, Pay_Basis,
                         Unit_No, Truck_Description, Created_By)
    VALUES (@DriverCode, @FirstName, @LastName, @Address1, @Address2, @City, @State, @PostalCode, @Country,
            @SsnLast4, @Job, @PayRate, @PayFrequency, @PayGroup, @Location, @Department, @JobType, @DriverType, @PayBasis,
            @UnitNo, @TruckDescription, @CallerUuid);
END
ELSE IF @Do = 'save'
BEGIN
    UPDATE DRVR.Drivers
       SET First_Name = @FirstName, Last_Name = @LastName, Address1 = @Address1, Address2 = @Address2, City = @City, State = @State,
           Postal_Code = @PostalCode, Country = @Country, Job = @Job, Job_Type = @JobType, Location = @Location,
           Department = @Department, Unit_No = @UnitNo, Truck_Description = @TruckDescription,
           -- Pay only when an admin sent it; otherwise as it was.
           Driver_Type   = CASE WHEN @PayGiven = 1 THEN COALESCE(@DriverType, Driver_Type) ELSE Driver_Type END,
           SSN_Last4     = CASE WHEN @PayGiven = 1 THEN @SsnLast4     ELSE SSN_Last4 END,
           Pay_Rate      = CASE WHEN @PayGiven = 1 THEN @PayRate      ELSE Pay_Rate END,
           Pay_Frequency = CASE WHEN @PayGiven = 1 THEN @PayFrequency ELSE Pay_Frequency END,
           Pay_Basis     = CASE WHEN @PayGiven = 1 THEN @PayBasis     ELSE Pay_Basis END,
           Pay_Group     = CASE WHEN @PayGiven = 1 THEN @PayGroup     ELSE Pay_Group END,
           Updated_At = getdate()
     WHERE Driver_Code = @DriverCode;
END
ELSE IF @Do = 'active'
BEGIN
    UPDATE DRVR.Drivers SET IsActive = CASE WHEN @Active = 1 THEN 1 ELSE 0 END, Updated_At = getdate()
     WHERE Driver_Code = @DriverCode;
END;

-- The driver as stored after: 09's loadDriver.
SELECT d.Driver_Code AS driverCode, d.First_Name AS firstName, d.Last_Name AS lastName,
       d.Address1 AS address1, d.Address2 AS address2, d.City AS city, d.State AS state,
       d.Postal_Code AS postalCode, d.Country AS country,
       d.Job AS job, d.Job_Type AS jobType, d.Location AS location, d.Department AS department,
       d.Unit_No AS unitNo, d.Truck_Description AS truckDescription, d.Driver_Type AS driverType,
       CAST(CASE WHEN ISNULL(d.IsActive, 1) = 1 THEN 1 ELSE 0 END AS bit) AS isActive,
       CAST(CASE WHEN d.User_Uuid IS NULL THEN 0 ELSE 1 END AS bit) AS hasLogin,
       COALESCE(CONVERT(varchar(23), d.Updated_At, 121), 'none') AS version,
       CAST(@CallerIsAdmin AS bit) AS canSeePay,
       CASE WHEN @CallerIsAdmin = 1 THEN d.SSN_Last4     END AS ssnLast4,
       CASE WHEN @CallerIsAdmin = 1 THEN d.Pay_Rate      END AS payRate,
       CASE WHEN @CallerIsAdmin = 1 THEN d.Pay_Frequency END AS payFrequency,
       CASE WHEN @CallerIsAdmin = 1 THEN d.Pay_Basis     END AS payBasis,
       CASE WHEN @CallerIsAdmin = 1 THEN d.Pay_Group     END AS payGroup
  FROM DRVR.Drivers d
 WHERE d.Driver_Code = @DriverCode;

IF @Keep = 1 COMMIT TRANSACTION;
ELSE BEGIN ROLLBACK TRANSACTION; PRINT 'Tried, and rolled back. Set @Keep = 1 to keep it.'; END;
