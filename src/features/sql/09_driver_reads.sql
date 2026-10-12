------------------------------------------------------------------------------
-- 09_driver_reads.sql -- the two reads the Driver Master tab makes, as the
-- server runs them, each with WHO may make it written into it.
--
-- NOT A SETUP SCRIPT. These are the API's queries, runnable here with the
-- parameters below to see what each returns before any API code exists.
-- Nothing here writes, so the whole file can be run at once. They answer as
-- driver-master/scope.ts does, and scope.test.ts is the list of what that
-- means.
--
-- NEEDS: 01_DRVR_Drivers.sql.
--
-- WHO. Dispatch and admin; anyone else -- a driver -- is REFUSED (THROW
-- 50403), not answered with an empty list. Pay is admin's alone: for anyone
-- else its columns come back NULL from here, so it never leaves the
-- database. The API fills the caller parameters from the session -- never
-- from the request body:
--   @CallerUuid        the signed-in user
--   @CallerIsDispatch  1 for dispatch or admin (as in 03 and 05)
--   @CallerIsAdmin     1 for admin only
--
-- SHAPE. Columns named as driver-master/contract.ts names them. What the
-- API does before handing them over:
--   * loadDriverList: the second result set is `you` -- what the caller may do;
--   * loadDriver: folds ssnLast4 ... payGroup into `pay` when canSeePay is
--     1, and sends `pay: null` when it is 0 (payBasis is NULL for every
--     company driver, so NULL alone cannot say which);
--   * isActive and hasLogin arrive as bits: true and false on the wire.
--
-- VERSION. A driver's `version` is Updated_At, to the millisecond, as text.
-- A save hands back the version it read (10_driver_writes.sql), and is
-- refused if the row has changed since. The screen never parses it.
------------------------------------------------------------------------------
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

-- Try it: set these, then run the file, or one read at a time.
DECLARE @CallerUuid       uniqueidentifier = NULL;
DECLARE @CallerIsDispatch bit              = 1;
DECLARE @CallerIsAdmin    bit              = 0;
DECLARE @IncludeInactive  bit              = 0;
DECLARE @DriverCode       varchar(20)      = 'TBOONE';

------------------------------------------------------------------------------
-- loadDriverList: a line per driver -- active ones, or everyone with
-- @IncludeInactive -- with no address, SSN or pay; and what the caller may do.
-- WHO: dispatch or admin.
------------------------------------------------------------------------------
IF @CallerIsDispatch = 0 AND @CallerIsAdmin = 0 THROW 50403, 'Only dispatch and admin keep the driver master.', 1;

SELECT d.Driver_Code AS driverCode, d.First_Name AS firstName, d.Last_Name AS lastName,
       d.City AS city, d.State AS state, d.Job AS job, d.Driver_Type AS driverType, d.Unit_No AS unitNo,
       CAST(CASE WHEN ISNULL(d.IsActive, 1) = 1 THEN 1 ELSE 0 END AS bit) AS isActive,
       CAST(CASE WHEN d.User_Uuid IS NULL THEN 0 ELSE 1 END AS bit) AS hasLogin
  FROM DRVR.Drivers d
 WHERE @IncludeInactive = 1 OR ISNULL(d.IsActive, 1) = 1
 ORDER BY d.Last_Name, d.First_Name, d.Driver_Code;

SELECT CAST(@CallerIsAdmin AS bit) AS canAdd, CAST(@CallerIsAdmin AS bit) AS canSeePay;

------------------------------------------------------------------------------
-- loadDriver: one driver, everything about them -- pay for an admin, NULLs
-- for anyone else. No row for a code nobody has. A driver who has left
-- comes back too: that is how they are brought back.
-- WHO: dispatch or admin; pay, admin only.
------------------------------------------------------------------------------
IF @CallerIsDispatch = 0 AND @CallerIsAdmin = 0 THROW 50403, 'Only dispatch and admin keep the driver master.', 1;

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
