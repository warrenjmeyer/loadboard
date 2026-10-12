------------------------------------------------------------------------------
-- drivers_to_drvr.sql -- turn Millstream's drivers into a script for THEIR
-- server's DRVR.Drivers. The same method as loads_to_tms.sql, for the same
-- reason: SSMS already reaches both servers, so this produces TEXT to carry
-- across instead of connecting the two databases.
--
-- HOW TO RUN IT
--   1. Open this on millstream-wjm, database Millstream, as sqlmillstream.
--   2. Ctrl+D -- Results to GRID. (Not Results to Text: it truncates each
--      column at 256 characters by default and would cut lines in half.)
--   3. Execute. Click the column header to select the whole column, Ctrl+C.
--   4. New query window on mvp-techgacity. Paste. The first line says how
--      many drivers it carries -- check it. Execute.
--   01_DRVR_Drivers.sql must have been run there first; the pasted script
--   stops with that message if it has not.
--
-- WHAT THE OUTPUT DOES. One MERGE, matched on Driver_Code:
--   * a driver not there is INSERTED;
--   * a driver there is UPDATED only if something actually differs, so
--     Updated_At means "changed", not "copied again";
--   * nothing is deleted, and User_Uuid, IsActive and Driver_Id are never
--     touched -- they belong to their side. Running it twice is safe.
--   A driver who leaves the load board is NOT removed there: set IsActive = 0
--   by hand, deliberately, since their stays still point at them.
--
-- ONCE THE DRIVER MASTER TAB IS IN USE, DO NOT RE-RUN THIS. That tab edits
-- DRVR.Drivers directly (10_driver_writes.sql), and this MERGE updates
-- every column it carries from Millstream -- so an address or pay rate
-- corrected there is put back to Millstream's. From then on DRVR.Drivers is
-- the master; add new drivers in the tab.
--
-- WHAT IT CARRIES: every column of dbo.Drivers, renamed into Title_Case.
-- They are test drivers, so nothing is held back -- see 01_DRVR_Drivers.sql.
--
-- ESCAPING. Single quotes are doubled. A carriage return or newline inside a
-- value becomes a space -- names, addresses, towns -- because one line per
-- driver is what makes copying a column of results safe. Pay_Rate goes out
-- as a plain number, which SQL Server reads back the same under any setting.
------------------------------------------------------------------------------
SET NOCOUNT ON;

WITH d AS (
    -- Each value as an N'...' literal, a number, or NULL.
    SELECT driver_code,
           'N''' + REPLACE(REPLACE(REPLACE(driver_code,   '''', ''''''), CHAR(13), ' '), CHAR(10), ' ') + '''' AS q_code,
           'N''' + REPLACE(REPLACE(REPLACE(first_name,    '''', ''''''), CHAR(13), ' '), CHAR(10), ' ') + '''' AS q_first,
           'N''' + REPLACE(REPLACE(REPLACE(last_name,     '''', ''''''), CHAR(13), ' '), CHAR(10), ' ') + '''' AS q_last,
           'N''' + REPLACE(REPLACE(REPLACE(address1,      '''', ''''''), CHAR(13), ' '), CHAR(10), ' ') + '''' AS q_addr1,
           ISNULL('N''' + REPLACE(REPLACE(REPLACE(address2, '''', ''''''), CHAR(13), ' '), CHAR(10), ' ') + '''', 'NULL') AS q_addr2,
           'N''' + REPLACE(REPLACE(REPLACE(city,          '''', ''''''), CHAR(13), ' '), CHAR(10), ' ') + '''' AS q_city,
           'N''' + REPLACE(REPLACE(REPLACE(state,         '''', ''''''), CHAR(13), ' '), CHAR(10), ' ') + '''' AS q_state,
           'N''' + REPLACE(REPLACE(REPLACE(postal_code,   '''', ''''''), CHAR(13), ' '), CHAR(10), ' ') + '''' AS q_postal,
           'N''' + REPLACE(REPLACE(REPLACE(country,       '''', ''''''), CHAR(13), ' '), CHAR(10), ' ') + '''' AS q_country,
           'N''' + REPLACE(REPLACE(REPLACE(ssn_last4,     '''', ''''''), CHAR(13), ' '), CHAR(10), ' ') + '''' AS q_ssn,
           'N''' + REPLACE(REPLACE(REPLACE(job,           '''', ''''''), CHAR(13), ' '), CHAR(10), ' ') + '''' AS q_job,
           CONVERT(VARCHAR(30), pay_rate) AS q_rate,
           'N''' + REPLACE(REPLACE(REPLACE(pay_frequency, '''', ''''''), CHAR(13), ' '), CHAR(10), ' ') + '''' AS q_freq,
           'N''' + REPLACE(REPLACE(REPLACE(pay_group,     '''', ''''''), CHAR(13), ' '), CHAR(10), ' ') + '''' AS q_group,
           'N''' + REPLACE(REPLACE(REPLACE(location,      '''', ''''''), CHAR(13), ' '), CHAR(10), ' ') + '''' AS q_location,
           'N''' + REPLACE(REPLACE(REPLACE(department,    '''', ''''''), CHAR(13), ' '), CHAR(10), ' ') + '''' AS q_dept,
           'N''' + REPLACE(REPLACE(REPLACE(job_type,      '''', ''''''), CHAR(13), ' '), CHAR(10), ' ') + '''' AS q_jobtype,
           'N''' + REPLACE(REPLACE(REPLACE(driver_type,   '''', ''''''), CHAR(13), ' '), CHAR(10), ' ') + '''' AS q_drvtype,
           ISNULL('N''' + REPLACE(REPLACE(REPLACE(pay_basis,         '''', ''''''), CHAR(13), ' '), CHAR(10), ' ') + '''', 'NULL') AS q_basis,
           ISNULL('N''' + REPLACE(REPLACE(REPLACE(unit_no,           '''', ''''''), CHAR(13), ' '), CHAR(10), ' ') + '''', 'NULL') AS q_unit,
           ISNULL('N''' + REPLACE(REPLACE(REPLACE(truck_description, '''', ''''''), CHAR(13), ' '), CHAR(10), ' ') + '''', 'NULL') AS q_truck
      FROM dbo.Drivers
),
script AS (
    -- Header: the count first, so a truncated paste is obvious; then the
    -- guard, so pasting before 01_DRVR_Drivers.sql says so plainly.
    SELECT 0 AS part, 0 AS seq,
           CAST('-- ' + CONVERT(VARCHAR(10), COUNT(*)) + ' drivers from Millstream.dbo.Drivers, generated '
                + CONVERT(VARCHAR(19), SYSUTCDATETIME(), 126) + 'Z' AS NVARCHAR(MAX)) AS line
      FROM d
    UNION ALL SELECT 0, 1, 'SET NOCOUNT ON;'
    -- DRVR.Drivers has a filtered index, and writing to such a table needs
    -- this ON. SSMS has it on; sqlcmd does not. Set, not assumed.
    UNION ALL SELECT 0, 2, 'SET QUOTED_IDENTIFIER ON; SET ANSI_NULLS ON;'
    UNION ALL SELECT 0, 3, 'IF OBJECT_ID(N''DRVR.Drivers'', N''U'') IS NULL THROW 50000, ''DRVR.Drivers does not exist here. Run 01_DRVR_Drivers.sql first.'', 1;'
    UNION ALL SELECT 0, 4, 'MERGE DRVR.Drivers AS t'
    UNION ALL SELECT 0, 5, 'USING (VALUES'

    -- One line per driver.
    UNION ALL
    SELECT 1, CAST(ROW_NUMBER() OVER (ORDER BY driver_code) AS INT),
           CONCAT(
             CASE WHEN ROW_NUMBER() OVER (ORDER BY driver_code) = 1 THEN '      (' ELSE '     ,(' END,
             q_code, ', ', q_first, ', ', q_last, ', ', q_addr1, ', ', q_addr2, ', ', q_city, ', ', q_state, ', ',
             q_postal, ', ', q_country, ', ', q_ssn, ', ', q_job, ', ', q_rate, ', ', q_freq, ', ', q_group, ', ',
             q_location, ', ', q_dept, ', ', q_jobtype, ', ', q_drvtype, ', ', q_basis, ', ', q_unit, ', ', q_truck,
             ')')
      FROM d

    -- Footer: the columns, the match, and each side of it.
    UNION ALL SELECT 2, 0, ') AS s (Driver_Code, First_Name, Last_Name, Address1, Address2, City, State, Postal_Code, Country, SSN_Last4,'
    UNION ALL SELECT 2, 1, '        Job, Pay_Rate, Pay_Frequency, Pay_Group, Location, Department, Job_Type, Driver_Type, Pay_Basis, Unit_No, Truck_Description)'
    UNION ALL SELECT 2, 2, '   ON t.Driver_Code = s.Driver_Code'
    -- EXCEPT, not <>: it treats two NULLs as equal, so a driver with no
    -- truck on both sides is not "changed" on every run.
    UNION ALL SELECT 2, 3, ' WHEN MATCHED AND EXISTS ('
    UNION ALL SELECT 2, 4, '        SELECT s.First_Name, s.Last_Name, s.Address1, s.Address2, s.City, s.State, s.Postal_Code, s.Country, s.SSN_Last4, s.Job, s.Pay_Rate,'
    UNION ALL SELECT 2, 5, '               s.Pay_Frequency, s.Pay_Group, s.Location, s.Department, s.Job_Type, s.Driver_Type, s.Pay_Basis, s.Unit_No, s.Truck_Description'
    UNION ALL SELECT 2, 6, '        EXCEPT'
    UNION ALL SELECT 2, 7, '        SELECT t.First_Name, t.Last_Name, t.Address1, t.Address2, t.City, t.State, t.Postal_Code, t.Country, t.SSN_Last4, t.Job, t.Pay_Rate,'
    UNION ALL SELECT 2, 8, '               t.Pay_Frequency, t.Pay_Group, t.Location, t.Department, t.Job_Type, t.Driver_Type, t.Pay_Basis, t.Unit_No, t.Truck_Description)'
    UNION ALL SELECT 2, 9, '   THEN UPDATE SET t.First_Name = s.First_Name, t.Last_Name = s.Last_Name, t.Address1 = s.Address1, t.Address2 = s.Address2,'
    UNION ALL SELECT 2, 10, '                   t.City = s.City, t.State = s.State, t.Postal_Code = s.Postal_Code, t.Country = s.Country, t.SSN_Last4 = s.SSN_Last4,'
    UNION ALL SELECT 2, 11, '                   t.Job = s.Job, t.Pay_Rate = s.Pay_Rate, t.Pay_Frequency = s.Pay_Frequency, t.Pay_Group = s.Pay_Group,'
    UNION ALL SELECT 2, 12, '                   t.Location = s.Location, t.Department = s.Department, t.Job_Type = s.Job_Type, t.Driver_Type = s.Driver_Type,'
    UNION ALL SELECT 2, 13, '                   t.Pay_Basis = s.Pay_Basis, t.Unit_No = s.Unit_No, t.Truck_Description = s.Truck_Description, t.Updated_At = getdate()'
    UNION ALL SELECT 2, 14, ' WHEN NOT MATCHED THEN INSERT (Driver_Code, First_Name, Last_Name, Address1, Address2, City, State, Postal_Code, Country, SSN_Last4,'
    UNION ALL SELECT 2, 15, '        Job, Pay_Rate, Pay_Frequency, Pay_Group, Location, Department, Job_Type, Driver_Type, Pay_Basis, Unit_No, Truck_Description)'
    UNION ALL SELECT 2, 16, '     VALUES (s.Driver_Code, s.First_Name, s.Last_Name, s.Address1, s.Address2, s.City, s.State, s.Postal_Code, s.Country, s.SSN_Last4,'
    UNION ALL SELECT 2, 17, '        s.Job, s.Pay_Rate, s.Pay_Frequency, s.Pay_Group, s.Location, s.Department, s.Job_Type, s.Driver_Type, s.Pay_Basis, s.Unit_No, s.Truck_Description);'
    UNION ALL SELECT 2, 18, 'PRINT CONVERT(VARCHAR(10), @@ROWCOUNT) + '' drivers inserted or changed in DRVR.Drivers'';'
)
SELECT line FROM script ORDER BY part, seq;
