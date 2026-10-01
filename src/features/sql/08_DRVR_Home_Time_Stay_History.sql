------------------------------------------------------------------------------
-- 08_DRVR_Home_Time_Stay_History.sql -- one row per move of a stay: the
-- driver asking, dispatch approving or declining, a cancel, GeoTab or
-- dispatch saying the driver got home or left, a correction. Nothing in it is
-- ever changed or deleted.
--
-- RUN ON: mvp-techgacity, in SSMS. Once, after 02_DRVR_Home_Time_Stays.sql.
-- 07_stay_writes.sql writes here in the same transaction as every move, so
-- run this before using 07 with @Keep = 1.
--
-- NEEDS, and stops with a sentence if they are missing:
--   DRVR.Home_Time_Stays      02_DRVR_Home_Time_Stays.sql
--   DRVR.fk_Home_Time_Status  created through the app (REQUESTED ... CANCELLED)
-- WANTS:
--   DRVR.fk_Home_Time_Source  as in 02: tied to it if it is there.
--
-- WHY. DRVR.Home_Time_Stays keeps a stay as it is NOW: approved and then
-- cancelled reads CANCELLED, and the approval is gone. This keeps the way it
-- got there -- who moved it, when, and from what to what.
--
-- WHICH MOVE. There is no action column, and no lookup table to make for
-- one: the move is From -> To, in the statuses the app already has.
--   (none)    -> REQUESTED   the driver asked
--   REQUESTED -> APPROVED    approved          REQUESTED -> DECLINED  declined
--   ...       -> CANCELLED   cancelled         APPROVED  -> HOME      arrived
--   HOME      -> DONE        left              same      -> same      corrected
--
-- EACH ROW IS THE STAY AS THAT MOVE LEFT IT: status, decline reason,
-- arrived and left with their sources. So a correction shows the times it
-- put right, and the row before it shows what they were.
------------------------------------------------------------------------------
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

IF OBJECT_ID(N'DRVR.Home_Time_Stays', N'U') IS NULL
    THROW 50000, 'DRVR.Home_Time_Stays is not here, or this login may not see it (00_check_permissions.sql says which). It is made by 02_DRVR_Home_Time_Stays.sql.', 1;
IF COL_LENGTH(N'DRVR.fk_Home_Time_Status', N'Home_Time_Status_Id') IS NULL
    THROW 50000, 'DRVR.fk_Home_Time_Status (with Home_Time_Status_Id) is not here, or this login may not see it (00_check_permissions.sql says which). It is created through the app.', 1;
IF OBJECT_ID(N'DRVR.Home_Time_Stay_History', N'U') IS NOT NULL
    THROW 50000, 'DRVR.Home_Time_Stay_History already exists. This script creates it; it does not change it.', 1;

CREATE TABLE DRVR.Home_Time_Stay_History (
    Home_Time_Stay_History_Id int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Home_Time_Stay_History PRIMARY KEY,

    Home_Time_Stay_Id    int NOT NULL
                         CONSTRAINT FK_Home_Time_Stay_History_Stay REFERENCES DRVR.Home_Time_Stays (Home_Time_Stay_Id),

    -- THE MOVE. From is NULL only on the request that made the stay.
    From_Status_Id       int NULL
                         CONSTRAINT FK_Home_Time_Stay_History_From REFERENCES DRVR.fk_Home_Time_Status (Home_Time_Status_Id),
    To_Status_Id         int NOT NULL
                         CONSTRAINT FK_Home_Time_Stay_History_To   REFERENCES DRVR.fk_Home_Time_Status (Home_Time_Status_Id),
    Moved_At             datetimeoffset(0) NOT NULL CONSTRAINT DF_Home_Time_Stay_History_Moved_At DEFAULT (SYSDATETIMEOFFSET()),
    Moved_By             uniqueidentifier NULL,       -- the signed-in user; NULL for a server job (GeoTab)

    -- THE STAY AS THE MOVE LEFT IT.
    Decline_Reason       nvarchar(500) NULL,
    Arrived_At           datetimeoffset(0) NULL,
    Arrived_Source_Id    int NULL,
    Left_At              datetimeoffset(0) NULL,
    Left_Source_Id       int NULL,

    -- The standard columns, as on every table here.
    IsActive             int              NULL     CONSTRAINT DF_Home_Time_Stay_History_IsActive   DEFAULT ((1)),
    Created_At           datetime         NULL     CONSTRAINT DF_Home_Time_Stay_History_Created_At DEFAULT (getdate()),
    Updated_At           datetime         NULL     CONSTRAINT DF_Home_Time_Stay_History_Updated_At DEFAULT (getdate()),
    Created_By           uniqueidentifier NULL,
    j                    int              NOT NULL CONSTRAINT DF_Home_Time_Stay_History_j          DEFAULT ((1)),
    TTP_ID               int              NULL     CONSTRAINT DF_Home_Time_Stay_History_TTP_ID     DEFAULT ((0))
);

-- One stay's moves, in order.
CREATE INDEX IX_Home_Time_Stay_History_Stay ON DRVR.Home_Time_Stay_History (Home_Time_Stay_Id, Moved_At);

IF COL_LENGTH(N'DRVR.fk_Home_Time_Source', N'Home_Time_Source_Id') IS NOT NULL
BEGIN
    ALTER TABLE DRVR.Home_Time_Stay_History ADD
        CONSTRAINT FK_Home_Time_Stay_History_Arrived_Source FOREIGN KEY (Arrived_Source_Id) REFERENCES DRVR.fk_Home_Time_Source (Home_Time_Source_Id),
        CONSTRAINT FK_Home_Time_Stay_History_Left_Source    FOREIGN KEY (Left_Source_Id)    REFERENCES DRVR.fk_Home_Time_Source (Home_Time_Source_Id);
    PRINT 'DRVR.Home_Time_Stay_History created, with its sources tied to DRVR.fk_Home_Time_Source.';
END
ELSE
BEGIN
    PRINT 'DRVR.Home_Time_Stay_History created. DRVR.fk_Home_Time_Source does not exist yet, so the source columns are not tied to it.';
    PRINT 'Once it is created through the app (GEOTAB, DISPATCH), run:';
    PRINT '  ALTER TABLE DRVR.Home_Time_Stay_History ADD CONSTRAINT FK_Home_Time_Stay_History_Arrived_Source FOREIGN KEY (Arrived_Source_Id) REFERENCES DRVR.fk_Home_Time_Source (Home_Time_Source_Id);';
    PRINT '  ALTER TABLE DRVR.Home_Time_Stay_History ADD CONSTRAINT FK_Home_Time_Stay_History_Left_Source FOREIGN KEY (Left_Source_Id) REFERENCES DRVR.fk_Home_Time_Source (Home_Time_Source_Id);';
END

-- Every stay already here gets the one row it can honestly have: that it was
-- asked for, by its driver, when it was. Later moves before this table
-- existed are not known, so none are made up; a stay already APPROVED shows
-- only its request until it moves again.
INSERT DRVR.Home_Time_Stay_History (Home_Time_Stay_Id, From_Status_Id, To_Status_Id, Moved_At, Moved_By, Created_By)
SELECT s.Home_Time_Stay_Id, NULL, st.Home_Time_Status_Id, s.Requested_At, s.Created_By, s.Created_By
  FROM DRVR.Home_Time_Stays s
 CROSS JOIN (SELECT Home_Time_Status_Id FROM DRVR.fk_Home_Time_Status WHERE Home_Time_Status = 'REQUESTED') st;
PRINT CONCAT(@@ROWCOUNT, ' stay(s) already here given their request row.');
