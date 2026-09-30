------------------------------------------------------------------------------
-- 01_DRVR_Drivers.sql -- the drivers, on THEIR server.
--
-- RUN ON: mvp-techgacity (dev-techgacity-sqlserver), in SSMS. Once.
--
-- The MyTechgacity database had no drivers table, and the Get Me Home
-- Planner and the Driver Home Time Schedule both need one: a stay belongs to
-- a driver, and a trip home ends at theirs. The load board's dbo.Drivers is
-- the source; drivers_to_drvr.sql copies it across and can be re-run.
--
-- EVERY COLUMN of the load board's table comes across, renamed into this
-- database's conventions (Title_Case) -- the drivers are test drivers, made
-- up, so nothing in them needs holding back (Warren, 2026-09-29). The table
-- will outlive them, though: if real drivers are ever entered here, SSN_Last4
-- and the Pay_ columns will hold real data in this database, and that is the
-- moment to decide whether they belong here.
--
-- ADDED, not copied: Driver_Id (an int identity key, as every table here
-- has), User_Uuid (see below), and the standard columns every table here
-- carries -- IsActive, Created_At, Updated_At, Created_By, j, TTP_ID, the
-- last two copied as the pattern has them; what they mean is not known here.
------------------------------------------------------------------------------
SET NOCOUNT ON;
-- Filtered indexes (UX_Drivers_User_Uuid) need these ON to be created, and to
-- insert or update the table afterwards. SSMS turns them on by default;
-- sqlcmd and some older drivers do not, so they are set here, not assumed.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

IF SCHEMA_ID(N'DRVR') IS NULL
    THROW 50000, 'There is no DRVR schema here, or this login may not see it (00_check_permissions.sql says which). Is this the database with DRVR.fk_Home_Time_Status in it?', 1;

IF OBJECT_ID(N'DRVR.Drivers', N'U') IS NOT NULL
    THROW 50000, 'DRVR.Drivers already exists. This script creates it; it does not change it.', 1;

CREATE TABLE DRVR.Drivers (
    Driver_Id          int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Drivers PRIMARY KEY,

    -- The load board's key for a driver, and the join back to it: the copy
    -- script matches on this, and the load board's API and GeoTab both know
    -- a driver by it. Unique, so a second copy cannot make a second driver.
    Driver_Code        varchar(20)   NOT NULL CONSTRAINT UQ_Drivers_Driver_Code UNIQUE,

    First_Name         nvarchar(50)  NOT NULL,
    Last_Name          nvarchar(50)  NOT NULL,

    -- Their address. City and State are also where "home" is for both tabs:
    -- the town, placed on the map by the GeoTab zone of the same name.
    Address1           nvarchar(100) NOT NULL,
    Address2           nvarchar(100) NULL,
    City               nvarchar(60)  NOT NULL,
    State              nchar(2)      NOT NULL,
    Postal_Code        varchar(10)   NOT NULL,
    Country            nvarchar(40)  NOT NULL CONSTRAINT DF_Drivers_Country DEFAULT (N'USA'),

    SSN_Last4          char(4)       NOT NULL,

    -- "OTR Driver", "Regional"... Job picks how long they can be out before
    -- they are overdue home.
    Job                nvarchar(60)  NOT NULL,
    Pay_Rate           decimal(9,4)  NOT NULL,
    Pay_Frequency      char(1)       NOT NULL CONSTRAINT DF_Drivers_Pay_Frequency DEFAULT ('W'),
    Pay_Group          nvarchar(20)  NOT NULL,
    Location           nvarchar(60)  NOT NULL,
    Department         nvarchar(60)  NOT NULL,
    Job_Type           nvarchar(60)  NOT NULL,
    Driver_Type        varchar(10)   NOT NULL CONSTRAINT DF_Drivers_Driver_Type DEFAULT ('COMPANY'),
    Pay_Basis          varchar(12)   NULL,

    -- Their regular truck. GeoTab may put them in another one on a given day.
    Unit_No            varchar(20)   NULL,
    Truck_Description  nvarchar(80)  NULL,

    -- WHO THIS DRIVER IS WHEN THEY SIGN IN: their user in this app, once they
    -- have one. This is what lets the server answer "is this your stay?" --
    -- a driver's reads must return their own stays and nobody else's, and
    -- the only thing the server knows about a request is who sent it.
    -- Empty until drivers have accounts; unique when filled. Not copied:
    -- the load board has no such thing, and the copy never touches it.
    User_Uuid          uniqueidentifier NULL,

    -- The standard columns, as on every table here.
    IsActive           int              NULL     CONSTRAINT DF_Drivers_IsActive   DEFAULT ((1)),
    Created_At         datetime         NULL     CONSTRAINT DF_Drivers_Created_At DEFAULT (getdate()),
    Updated_At         datetime         NULL     CONSTRAINT DF_Drivers_Updated_At DEFAULT (getdate()),
    Created_By         uniqueidentifier NULL,
    j                  int              NOT NULL CONSTRAINT DF_Drivers_j          DEFAULT ((1)),
    TTP_ID             int              NULL     CONSTRAINT DF_Drivers_TTP_ID     DEFAULT ((0))
);

-- One driver per login -- but many drivers with no login yet.
CREATE UNIQUE INDEX UX_Drivers_User_Uuid ON DRVR.Drivers (User_Uuid) WHERE User_Uuid IS NOT NULL;

PRINT 'DRVR.Drivers created. Next: drivers_to_drvr.sql on Millstream, and paste its output here.';
