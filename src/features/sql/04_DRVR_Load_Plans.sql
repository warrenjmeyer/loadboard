------------------------------------------------------------------------------
-- 04_DRVR_Load_Plans.sql -- one row per time a load is put on a driver's
-- plan. The Driver Load Plans tab's store.
--
-- RUN ON: mvp-techgacity, in SSMS. Once, after 01_DRVR_Drivers.sql.
--
-- NEEDS, and stops with a sentence if they are missing:
--   DRVR.Drivers              01_DRVR_Drivers.sql
--   DRVR.fk_Load_Plan_Status  created through the app: PLANNED, TAKEN_BACK
--   TMS.Loads                 theirs; the loads being planned
--
-- DECIDED 2026-09-29 (Warren):
--   * Planning writes HERE and nowhere else. TMS.Loads is the TMS side's
--     table; its status and driver_code are left alone.
--   * One step: a load is PLANNED, or it was TAKEN_BACK.
--   * A load taken back keeps its row, marked TAKEN_BACK, so there is a
--     record of who planned what and when it came off. Putting it on a
--     plan again is a new row.
--   * A driver's plan is ordered by the loads' pickup times. Nothing here
--     stores an order that could disagree with them.
--
-- What the database holds the line on:
--   * A LOAD IS ON ONE PLAN AT A TIME. The filtered unique index below
--     refuses a second current row for a load, so two dispatchers clicking
--     Assign on the same load at once cannot both win.
--   * The status and the take-back agree: PLANNED has no Taken_Back_At,
--     TAKEN_BACK has one. (A CHECK built below from the two Ids, looked up
--     by NAME when this runs.)
--   * Every plan has a real driver and a real status, and a real load when
--     TMS.Loads can be referenced (FOREIGN KEY; see the end).
-- What it does NOT: whether a load may be planned at all (not delivered,
-- not under way) -- that depends on TMS.Loads.status, whose words are the
-- TMS side's. The API holds that, running the same assign and unassign the
-- preview does (driver-load-plans/rules.ts). See 05_load_plan_reads.sql and 06_load_plan_writes.sql.
------------------------------------------------------------------------------
SET NOCOUNT ON;
-- Filtered indexes (UX_Load_Plans_Current_Load below, UX_Drivers_User_Uuid)
-- need these ON to be created, and to insert or update the table afterwards.
-- SSMS turns them on by default; sqlcmd and some older drivers do not.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

IF OBJECT_ID(N'DRVR.Drivers', N'U') IS NULL
    THROW 50000, 'DRVR.Drivers is not here, or this login may not see it (00_check_permissions.sql says which). It is made by 01_DRVR_Drivers.sql.', 1;
IF COL_LENGTH(N'DRVR.fk_Load_Plan_Status', N'Load_Plan_Status_Id') IS NULL
    THROW 50000, 'DRVR.fk_Load_Plan_Status (with Load_Plan_Status_Id) is not here, or this login may not see it (00_check_permissions.sql says which). It is created through the app: PLANNED, TAKEN_BACK.', 1;
IF COL_LENGTH(N'TMS.Loads', N'load_uuid') IS NULL
    THROW 50000, 'TMS.Loads (with load_uuid) is not here, or this login may not see it (00_check_permissions.sql says which). This runs on mvp-techgacity.', 1;
IF OBJECT_ID(N'DRVR.Load_Plans', N'U') IS NOT NULL
    THROW 50000, 'DRVR.Load_Plans already exists. This script creates it; it does not change it.', 1;
IF OBJECT_ID(N'DRVR.Loads_For_Planning', N'V') IS NOT NULL
    THROW 50000, 'DRVR.Loads_For_Planning already exists without DRVR.Load_Plans. Drop the view, then run this again.', 1;

-- The two statuses, found by NAME: the app hands Ids out in creation order.
DECLARE @Planned   int = (SELECT Load_Plan_Status_Id FROM DRVR.fk_Load_Plan_Status WHERE Load_Plan_Status = 'PLANNED');
DECLARE @TakenBack int = (SELECT Load_Plan_Status_Id FROM DRVR.fk_Load_Plan_Status WHERE Load_Plan_Status = 'TAKEN_BACK');
IF @Planned IS NULL OR @TakenBack IS NULL
    THROW 50000, 'DRVR.fk_Load_Plan_Status needs a row named PLANNED and a row named TAKEN_BACK, spelled exactly so.', 1;

CREATE TABLE DRVR.Load_Plans (
    Load_Plan_Id         int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Load_Plans PRIMARY KEY,

    -- The load: TMS.Loads.load_uuid, their key. Tied to it at the end of
    -- this script when this login may reference TMS.Loads.
    Load_Uuid            uniqueidentifier NOT NULL,

    Driver_Id            int NOT NULL
                         CONSTRAINT FK_Load_Plans_Driver REFERENCES DRVR.Drivers (Driver_Id),

    -- PLANNED or TAKEN_BACK. Written by Id, found by NAME: the API looks the
    -- Id up from the name, never assumes it.
    Load_Plan_Status_Id  int NOT NULL
                         CONSTRAINT FK_Load_Plans_Status REFERENCES DRVR.fk_Load_Plan_Status (Load_Plan_Status_Id),

    -- WHO PUT IT ON THE PLAN, AND WHEN. datetimeoffset, like every moment
    -- in these tables: it keeps the zone it was written in.
    Planned_At           datetimeoffset(0) NOT NULL CONSTRAINT DF_Load_Plans_Planned_At DEFAULT (SYSDATETIMEOFFSET()),
    Planned_By           uniqueidentifier NULL,       -- the dispatcher's user

    -- WHO TOOK IT BACK OFF, AND WHEN. Both empty while it is on the plan.
    Taken_Back_At        datetimeoffset(0) NULL,
    Taken_Back_By        uniqueidentifier NULL,

    -- The standard columns, as on every table here.
    IsActive             int              NULL     CONSTRAINT DF_Load_Plans_IsActive   DEFAULT ((1)),
    Created_At           datetime         NULL     CONSTRAINT DF_Load_Plans_Created_At DEFAULT (getdate()),
    Updated_At           datetime         NULL     CONSTRAINT DF_Load_Plans_Updated_At DEFAULT (getdate()),
    Created_By           uniqueidentifier NULL,
    j                    int              NOT NULL CONSTRAINT DF_Load_Plans_j          DEFAULT ((1)),
    TTP_ID               int              NULL     CONSTRAINT DF_Load_Plans_TTP_ID     DEFAULT ((0)),

    -- Nothing comes off a plan before it went on; nobody takes back without a when.
    CONSTRAINT CK_Load_Plans_Taken_Back_After_Planned CHECK (Taken_Back_At IS NULL OR Taken_Back_At >= Planned_At),
    CONSTRAINT CK_Load_Plans_Taken_Back_By_Needs_At  CHECK (Taken_Back_By IS NULL OR Taken_Back_At IS NOT NULL)
);

-- The status and the take-back agree. Built from the Ids found above, so it
-- names no Id that a database built in another order would not have. (Were
-- the lookup rows ever deleted and made again, drop and re-add this CHECK.)
DECLARE @check nvarchar(max) = N'ALTER TABLE DRVR.Load_Plans ADD CONSTRAINT CK_Load_Plans_Status_Matches CHECK ('
    + N'(Load_Plan_Status_Id = ' + CAST(@Planned AS nvarchar(10)) + N' AND Taken_Back_At IS NULL) OR '
    + N'(Load_Plan_Status_Id = ' + CAST(@TakenBack AS nvarchar(10)) + N' AND Taken_Back_At IS NOT NULL))';
EXEC sys.sp_executesql @check;

-- A LOAD IS ON ONE PLAN AT A TIME: at most one row per load not taken back.
CREATE UNIQUE INDEX UX_Load_Plans_Current_Load ON DRVR.Load_Plans (Load_Uuid) WHERE Taken_Back_At IS NULL;
-- A driver's plan: their current rows.
CREATE INDEX IX_Load_Plans_Driver ON DRVR.Load_Plans (Driver_Id) INCLUDE (Load_Uuid, Planned_At) WHERE Taken_Back_At IS NULL;
-- A load's history, current or not.
CREATE INDEX IX_Load_Plans_Load ON DRVR.Load_Plans (Load_Uuid, Planned_At);

------------------------------------------------------------------------------
-- DRVR.Loads_For_Planning -- every TMS load as planning sees it: its plan
-- state, the driver it is planned for, and the load's own facts. The four
-- reads in 05_load_plan_reads.sql all start here, so the one place where
-- TMS.Loads' status words meet the tab's states is this view.
--
--   Delivered, Cancelled  TMS.Loads.status says so
--   In Transit            TMS.Loads.status says the load is under way
--   Covered               on a plan (a current DRVR.Load_Plans row)
--   Available             none of the above
--
-- TMS.Loads.status holds the load board's words for now (Available, Covered,
-- In Transit, Delivered, Cancelled): their own 16-state lifecycle has no
-- Delivered or Cancelled, and is still an open question with them. When it
-- is settled, THIS is the view to change -- the words for "under way",
-- "delivered" and "cancelled" -- and nothing else.
--
-- The driver: the plan's, when there is one; otherwise, for a load under
-- way or delivered, whoever TMS.Loads says hauled it. An Available load has
-- none.
--
-- Times are TMS.Loads' own: a dock's wall-clock time, with no zone. The API
-- gives each its zone from the dock's state before it goes out, as the load
-- board's adapter does (get-me-home/adapters/dockTime.ts).
------------------------------------------------------------------------------
-- CREATE VIEW has to be the only statement in its batch, so it runs through
-- EXEC: that keeps this script ONE batch, and a THROW above stops all of it.
EXEC (N'
CREATE VIEW DRVR.Loads_For_Planning AS
SELECT l.load_uuid            AS Load_Uuid,
       l.load_number          AS Load_Number,
       st.Plan_State,
       CASE WHEN st.Plan_State = N''Available'' THEN NULL
            WHEN p.Load_Plan_Id IS NOT NULL THEN pd.Driver_Code
            ELSE l.driver_code END AS Driver_Code,
       p.Load_Plan_Id,
       p.Driver_Id            AS Planned_Driver_Id,
       p.Planned_At,
       p.Planned_By,
       l.origin               AS Origin,
       l.destination          AS Destination,
       l.pickup_start         AS Pickup_Start,
       l.pickup_end           AS Pickup_End,
       l.delivery_start       AS Delivery_Start,
       l.delivery_end         AS Delivery_End,
       l.miles                AS Miles,
       l.rate                 AS Rate,
       l.equipment            AS Equipment,
       l.status               AS Tms_Status
  FROM TMS.Loads l
  LEFT JOIN DRVR.Load_Plans p ON p.Load_Uuid = l.load_uuid AND p.Taken_Back_At IS NULL
  LEFT JOIN DRVR.Drivers pd   ON pd.Driver_Id = p.Driver_Id
 CROSS APPLY (SELECT CASE
        WHEN l.status IN (N''Delivered'')  THEN N''Delivered''
        WHEN l.status IN (N''Cancelled'')  THEN N''Cancelled''
        WHEN l.status IN (N''In Transit'') THEN N''In Transit''
        WHEN p.Load_Plan_Id IS NOT NULL  THEN N''Covered''
        ELSE N''Available'' END AS Plan_State) st
');

------------------------------------------------------------------------------
-- Tie Load_Uuid to TMS.Loads, if this login may. A foreign key into another
-- schema's table needs REFERENCES on it, which SELECT/INSERT/UPDATE do not
-- include. Without it the table works the same; the API refuses unknown
-- loads, and the line to run later is printed.
------------------------------------------------------------------------------
IF HAS_PERMS_BY_NAME(N'TMS.Loads', N'OBJECT', N'REFERENCES') = 1
BEGIN
    ALTER TABLE DRVR.Load_Plans ADD CONSTRAINT FK_Load_Plans_Load FOREIGN KEY (Load_Uuid) REFERENCES TMS.Loads (load_uuid);
    PRINT 'DRVR.Load_Plans and DRVR.Loads_For_Planning created, with every plan tied to its TMS.Loads row.';
END
ELSE
BEGIN
    PRINT 'DRVR.Load_Plans and DRVR.Loads_For_Planning created. This login may not reference TMS.Loads, so Load_Uuid is not tied to it.';
    PRINT 'Someone who may (REFERENCES on TMS.Loads, or db_owner) can run:';
    PRINT '  ALTER TABLE DRVR.Load_Plans ADD CONSTRAINT FK_Load_Plans_Load FOREIGN KEY (Load_Uuid) REFERENCES TMS.Loads (load_uuid);';
END
