------------------------------------------------------------------------------
-- local_reset_stays.sql -- LAPTOP ONLY. Puts the dispatcher's queue back.
--
-- Empties the laptop's home-time stays and their history, and files five
-- fresh requests, each AS ITS DRIVER (Created_By and the history's Moved_By
-- are the driver's made-up user from local_test_users.sql), so dispatch has
-- something to approve, decline and cancel:
--
--   TBOONE    home in 2 days 6 PM, back out 2 days later      a note
--   HBARNETT  home in 3 days noon, back out 3 days later
--   DFOSTER   home in 5 days noon, back out 2 days later      a note
--   MWEBB     home in 8 days 6 PM, back out 3 days later
--   RDELGADO  home in 9 days 5 PM, back out 3 days later      a note
--
-- Dates are from TODAY, at -05:00 (the preview's dispatcher), so the queue
-- is never in the past. Re-run it whenever you want to test the decisions
-- again from the start. Ids carry on from where they were (no reseed), so a
-- stay id seen before a reset is never reused for a different stay.
--
-- RUN IN: the laptop's mvp-techgacity (it refuses to run anywhere else),
-- after 02, 08 and local_test_users.sql.
------------------------------------------------------------------------------
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET XACT_ABORT ON;
IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 5
    THROW 50000, 'This is Azure SQL. This script only resets the laptop''s test stays.', 1;
IF DB_NAME() <> N'mvp-techgacity'
    THROW 50000, 'Run this in the laptop''s mvp-techgacity (made by local_stand_in.sql).', 1;
IF OBJECT_ID(N'DRVR.Home_Time_Stay_History', N'U') IS NULL
    THROW 50000, 'DRVR.Home_Time_Stay_History is not here yet. Run 08_DRVR_Home_Time_Stay_History.sql first.', 1;

DECLARE @Requested int = (SELECT Home_Time_Status_Id FROM DRVR.fk_Home_Time_Status WHERE Home_Time_Status = 'REQUESTED');
IF @Requested IS NULL THROW 50000, 'DRVR.fk_Home_Time_Status has no REQUESTED row.', 1;

-- Midnight today, at the dispatcher's -05:00.
DECLARE @Today datetimeoffset(0) = TODATETIMEOFFSET(CAST(CAST(SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00') AS date) AS datetime2(0)), '-05:00');

DECLARE @Seed TABLE (Driver_Code varchar(20), Home_By datetimeoffset(0), Back_Out datetimeoffset(0), Note nvarchar(500));
INSERT @Seed VALUES
    ('TBOONE',   DATEADD(hour, 2*24 + 18, @Today), DATEADD(hour, 4*24 +  6, @Today), N'Daughter''s birthday Saturday'),
    ('HBARNETT', DATEADD(hour, 3*24 + 12, @Today), DATEADD(hour, 6*24 +  6, @Today), NULL),
    ('DFOSTER',  DATEADD(hour, 5*24 + 12, @Today), DATEADD(hour, 7*24 +  6, @Today), N'Doctor appointment'),
    ('MWEBB',    DATEADD(hour, 8*24 + 18, @Today), DATEADD(hour, 11*24 + 6, @Today), NULL),
    ('RDELGADO', DATEADD(hour, 9*24 + 17, @Today), DATEADD(hour, 12*24 + 6, @Today), N'Long weekend');

DECLARE @Missing nvarchar(400) = (
    SELECT STRING_AGG(s.Driver_Code, ', ') FROM @Seed s
      LEFT JOIN DRVR.Drivers d ON d.Driver_Code = s.Driver_Code AND d.User_Uuid IS NOT NULL
     WHERE d.Driver_Id IS NULL);
IF @Missing IS NOT NULL
BEGIN
    SET @Missing = CONCAT(N'No driver with a user for: ', @Missing, N'. Run the drivers copy and local_test_users.sql.');
    THROW 50000, @Missing, 1;
END;

BEGIN TRANSACTION;

DELETE DRVR.Home_Time_Stay_History;
DELETE DRVR.Home_Time_Stays;
PRINT 'Laptop stays and their history emptied.';

DECLARE @Made TABLE (Home_Time_Stay_Id int, Created_By uniqueidentifier, Requested_At datetimeoffset(0));
INSERT DRVR.Home_Time_Stays (Driver_Id, Home_Time_Status_Id, Home_By, Back_Out, Note, Created_By)
OUTPUT inserted.Home_Time_Stay_Id, inserted.Created_By, inserted.Requested_At INTO @Made
SELECT d.Driver_Id, @Requested, s.Home_By, s.Back_Out, s.Note, d.User_Uuid
  FROM @Seed s JOIN DRVR.Drivers d ON d.Driver_Code = s.Driver_Code;

INSERT DRVR.Home_Time_Stay_History (Home_Time_Stay_Id, From_Status_Id, To_Status_Id, Moved_At, Moved_By, Created_By)
SELECT Home_Time_Stay_Id, NULL, @Requested, Requested_At, Created_By, Created_By FROM @Made;

COMMIT TRANSACTION;

SELECT s.Home_Time_Stay_Id AS Id, d.Driver_Code, st.Home_Time_Status AS Status, s.Home_By, s.Back_Out, s.Note
  FROM DRVR.Home_Time_Stays s
  JOIN DRVR.Drivers d             ON d.Driver_Id = s.Driver_Id
  JOIN DRVR.fk_Home_Time_Status st ON st.Home_Time_Status_Id = s.Home_Time_Status_Id
 ORDER BY s.Home_By;
