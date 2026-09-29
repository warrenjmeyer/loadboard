------------------------------------------------------------------------------
-- 02_DRVR_Home_Time_Stays.sql -- one row per stay: a driver's time at home,
-- from asking for it to driving away. The Driver Home Time Schedule's store.
--
-- RUN ON: mvp-techgacity, in SSMS. Once, after 01_DRVR_Drivers.sql.
--
-- NEEDS, and stops with a sentence if they are missing:
--   DRVR.Drivers              01_DRVR_Drivers.sql
--   DRVR.fk_Home_Time_Status  created through the app (REQUESTED ... CANCELLED)
-- WANTS:
--   DRVR.fk_Home_Time_Source  created through the app (GEOTAB, DISPATCH).
--   If it is not there yet the table is still created, and the two lines
--   that tie Arrived/Left_Source_Id to it are printed, to run once it is.
--
-- The columns are the Stay type in home-time-schedule/contract.ts, one for
-- one, in this database's conventions. What the database holds the line on:
--   * the times are in order (CHECK);
--   * every stay has a real driver and a real status (FOREIGN KEY);
--   * a driver with stays cannot be deleted -- set IsActive = 0 instead.
-- What it does NOT, because it would need a trigger to know a status by its
-- name: which moves are allowed (REQUESTED -> APPROVED, never back), that a
-- decline has a reason, who may do what. The API holds those, running the
-- same applyAction the preview does, from the signed-in user. See
-- 03_scoped_reads.sql for the reads, and who may make each.
------------------------------------------------------------------------------
SET NOCOUNT ON;
-- Filtered indexes (UX_Drivers_User_Uuid) need these ON to be created, and to
-- insert or update the table afterwards. SSMS turns them on by default;
-- sqlcmd and some older drivers do not, so they are set here, not assumed.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

IF OBJECT_ID(N'DRVR.Drivers', N'U') IS NULL
    THROW 50000, 'DRVR.Drivers does not exist. Run 01_DRVR_Drivers.sql first.', 1;
IF COL_LENGTH(N'DRVR.fk_Home_Time_Status', N'Home_Time_Status_Id') IS NULL
    THROW 50000, 'DRVR.fk_Home_Time_Status (with Home_Time_Status_Id) does not exist. Create it through the app first.', 1;
IF OBJECT_ID(N'DRVR.Home_Time_Stays', N'U') IS NOT NULL
    THROW 50000, 'DRVR.Home_Time_Stays already exists. This script creates it; it does not change it.', 1;

CREATE TABLE DRVR.Home_Time_Stays (
    Home_Time_Stay_Id    int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Home_Time_Stays PRIMARY KEY,

    Driver_Id            int NOT NULL
                         CONSTRAINT FK_Home_Time_Stays_Driver REFERENCES DRVR.Drivers (Driver_Id),

    -- REQUESTED ... CANCELLED. Written by Id, found by NAME: the API looks
    -- the Id up from the name (statusIds in statusTable.ts), never assumes it.
    Home_Time_Status_Id  int NOT NULL
                         CONSTRAINT FK_Home_Time_Stays_Status REFERENCES DRVR.fk_Home_Time_Status (Home_Time_Status_Id),

    -- WHAT WAS ASKED. datetimeoffset, not datetime: "home by 6 PM" has to
    -- keep its zone, or it moves an hour across a clock change or a server.
    Home_By              datetimeoffset(0) NOT NULL,
    Back_Out             datetimeoffset(0) NOT NULL,
    Note                 nvarchar(500) NULL,          -- the reason, in the driver's words
    Requested_At         datetimeoffset(0) NOT NULL CONSTRAINT DF_Home_Time_Stays_Requested_At DEFAULT (SYSDATETIMEOFFSET()),

    -- WHAT DISPATCH SAID.
    Decided_At           datetimeoffset(0) NULL,
    Decided_By           uniqueidentifier NULL,       -- the dispatcher's user
    Decline_Reason       nvarchar(500) NULL,          -- the driver sees this

    -- WHAT HAPPENED, and who said so: GeoTab saw the truck, or dispatch
    -- entered or corrected it. Tied to DRVR.fk_Home_Time_Source below.
    Arrived_At           datetimeoffset(0) NULL,
    Arrived_Source_Id    int NULL,
    Left_At              datetimeoffset(0) NULL,
    Left_Source_Id       int NULL,

    -- The standard columns, as on every table here.
    IsActive             int              NULL     CONSTRAINT DF_Home_Time_Stays_IsActive   DEFAULT ((1)),
    Created_At           datetime         NULL     CONSTRAINT DF_Home_Time_Stays_Created_At DEFAULT (getdate()),
    Updated_At           datetime         NULL     CONSTRAINT DF_Home_Time_Stays_Updated_At DEFAULT (getdate()),
    Created_By           uniqueidentifier NULL,
    j                    int              NOT NULL CONSTRAINT DF_Home_Time_Stays_j          DEFAULT ((1)),
    TTP_ID               int              NULL     CONSTRAINT DF_Home_Time_Stays_TTP_ID     DEFAULT ((0)),

    -- Back out after home by: a stay with no length is a typo.
    CONSTRAINT CK_Home_Time_Stays_Back_Out_After_Home_By CHECK (Back_Out > Home_By),
    -- Nobody leaves before arriving, or leaves without having arrived.
    CONSTRAINT CK_Home_Time_Stays_Left_After_Arrived CHECK (Left_At IS NULL OR (Arrived_At IS NOT NULL AND Left_At >= Arrived_At))
);

-- One index per scoped read (03_scoped_reads.sql), so each is a seek:
-- the queue (status, oldest first), one driver's stays, and the board's window.
CREATE INDEX IX_Home_Time_Stays_Queue  ON DRVR.Home_Time_Stays (Home_Time_Status_Id, Requested_At);
CREATE INDEX IX_Home_Time_Stays_Driver ON DRVR.Home_Time_Stays (Driver_Id, Home_By);
CREATE INDEX IX_Home_Time_Stays_Board  ON DRVR.Home_Time_Stays (Home_By, Back_Out) INCLUDE (Driver_Id, Home_Time_Status_Id, Arrived_At, Left_At);

-- The source lookup, if it is there yet.
IF COL_LENGTH(N'DRVR.fk_Home_Time_Source', N'Home_Time_Source_Id') IS NOT NULL
BEGIN
    ALTER TABLE DRVR.Home_Time_Stays ADD
        CONSTRAINT FK_Home_Time_Stays_Arrived_Source FOREIGN KEY (Arrived_Source_Id) REFERENCES DRVR.fk_Home_Time_Source (Home_Time_Source_Id),
        CONSTRAINT FK_Home_Time_Stays_Left_Source    FOREIGN KEY (Left_Source_Id)    REFERENCES DRVR.fk_Home_Time_Source (Home_Time_Source_Id);
    PRINT 'DRVR.Home_Time_Stays created, with its sources tied to DRVR.fk_Home_Time_Source.';
END
ELSE
BEGIN
    PRINT 'DRVR.Home_Time_Stays created. DRVR.fk_Home_Time_Source does not exist yet, so the source columns are not tied to it.';
    PRINT 'Once it is created through the app (GEOTAB, DISPATCH), run:';
    PRINT '  ALTER TABLE DRVR.Home_Time_Stays ADD CONSTRAINT FK_Home_Time_Stays_Arrived_Source FOREIGN KEY (Arrived_Source_Id) REFERENCES DRVR.fk_Home_Time_Source (Home_Time_Source_Id);';
    PRINT '  ALTER TABLE DRVR.Home_Time_Stays ADD CONSTRAINT FK_Home_Time_Stays_Left_Source FOREIGN KEY (Left_Source_Id) REFERENCES DRVR.fk_Home_Time_Source (Home_Time_Source_Id);';
END
