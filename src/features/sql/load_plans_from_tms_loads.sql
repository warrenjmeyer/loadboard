------------------------------------------------------------------------------
-- load_plans_from_tms_loads.sql -- puts every load TMS.Loads already has a
-- driver for onto that driver's plan.
--
-- RUN ON: mvp-techgacity, in SSMS, after 04_DRVR_Load_Plans.sql and after
-- the drivers are copied (drivers_to_drvr.sql). Safe to run again: a load
-- already on a plan is left as it is.
--
-- Why: the loads copied from the load board arrive Covered or In Transit
-- with a driver_code, but no plan row -- so the tab would show a Covered
-- load as Available. This gives each the row it would have had.
--
-- What comes across: Covered and In Transit loads whose driver_code is a
-- driver in DRVR.Drivers. Delivered loads do not: they are nobody's plan any
-- more, and the view already names who hauled them. Loads whose driver is
-- NOT in DRVR.Drivers are listed first and left alone.
--
-- Planned_At: when the load was last changed (updated_utc), the nearest the
-- load board recorded to when it was covered; now, when that is empty.
-- Planned_By is empty: nobody on this side planned them.
------------------------------------------------------------------------------
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET XACT_ABORT ON;

IF OBJECT_ID(N'DRVR.Load_Plans', N'U') IS NULL
    THROW 50000, 'DRVR.Load_Plans does not exist. Run 04_DRVR_Load_Plans.sql first.', 1;

DECLARE @Planned int = (SELECT Load_Plan_Status_Id FROM DRVR.fk_Load_Plan_Status WHERE Load_Plan_Status = 'PLANNED');

-- Said first: the loads that will NOT come across, and why.
SELECT l.load_number AS [not planned: load], l.status AS [status], l.driver_code AS [driver not in DRVR.Drivers]
  FROM TMS.Loads l
 WHERE l.status IN (N'Covered', N'In Transit') AND l.driver_code IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM DRVR.Drivers d WHERE d.Driver_Code = l.driver_code)
 ORDER BY l.load_number;

INSERT DRVR.Load_Plans (Load_Uuid, Driver_Id, Load_Plan_Status_Id, Planned_At)
SELECT l.load_uuid, d.Driver_Id, @Planned, COALESCE(TODATETIMEOFFSET(l.updated_utc, 0), SYSDATETIMEOFFSET())
  FROM TMS.Loads l
  JOIN DRVR.Drivers d ON d.Driver_Code = l.driver_code
 WHERE l.status IN (N'Covered', N'In Transit')
   AND NOT EXISTS (SELECT 1 FROM DRVR.Load_Plans p WHERE p.Load_Uuid = l.load_uuid AND p.Taken_Back_At IS NULL);

PRINT CONCAT(@@ROWCOUNT, ' load(s) put on their drivers'' plans.');
