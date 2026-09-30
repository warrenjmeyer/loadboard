------------------------------------------------------------------------------
-- local_stand_in.sql -- a stand-in for mvp-techgacity on THIS LAPTOP, so the
-- setup scripts can be run and the tabs' data tried while the real database
-- will not let Warren's login create tables (found 2026-09-29).
--
-- RUN ON: the laptop's own SQL Server (localhost, Windows authentication).
-- It refuses to run on Azure SQL, so it cannot touch the real host.
--
-- WHAT IT MAKES, in a database named mvp-techgacity like the real one -- so
-- every script that says "RUN ON: mvp-techgacity" runs here unchanged:
--   * schemas TMS and DRVR;
--   * TMS.Loads, column for column as theirs (listed from their server,
--     2026-09-16) -- so loads_to_tms.sql's output pastes in here as it does
--     there;
--   * the four lookup tables the app made, with EXACTLY the rows it made:
--     fk_get_me_home_status, fk_Home_Time_Status, fk_Home_Time_Source,
--     fk_Load_Plan_Status (from each feature's fixtures, which hold the rows
--     as SELECT * returned them).
-- What it does NOT make: DRVR.Drivers, the stays, the load plans. Those are
-- 01, 02 and 04 -- run them after this, exactly as on the host.
--
-- Safe to run again: it makes only what is missing.
------------------------------------------------------------------------------
SET NOCOUNT ON;
IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 5
    THROW 50000, 'This is Azure SQL. The stand-in is for the laptop''s own SQL Server only.', 1;
IF DB_ID(N'mvp-techgacity') IS NULL
BEGIN
    CREATE DATABASE [mvp-techgacity];
    PRINT 'Database mvp-techgacity created on this laptop.';
END
GO

USE [mvp-techgacity];
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 5
    THROW 50000, 'This is Azure SQL. The stand-in is for the laptop''s own SQL Server only.', 1;

IF SCHEMA_ID(N'TMS') IS NULL EXEC (N'CREATE SCHEMA TMS');
IF SCHEMA_ID(N'DRVR') IS NULL EXEC (N'CREATE SCHEMA DRVR');

-- TMS.Loads as their server has it. Their column 16 is missing -- a column
-- dropped on their side, so their numbering has a gap. No default on
-- load_uuid: loads_to_tms.sql supplies NEWID() itself.
IF OBJECT_ID(N'TMS.Loads', N'U') IS NULL
BEGIN
    CREATE TABLE TMS.Loads (
        load_uuid                  uniqueidentifier NOT NULL CONSTRAINT PK_Loads PRIMARY KEY,
        load_number                nvarchar(20)     NOT NULL,
        origin                     nvarchar(100)    NOT NULL,
        destination                nvarchar(100)    NOT NULL,
        miles                      int              NOT NULL,
        rate                       decimal(10,2)    NOT NULL,
        equipment                  nvarchar(50)     NOT NULL,
        status                     nvarchar(20)     NOT NULL,
        driver_code                varchar(20)      NULL,
        delivered_date             date             NULL,
        unit_no                    varchar(20)      NULL,
        pickup_start               datetime2        NULL,
        pickup_end                 datetime2        NULL,
        delivery_start             datetime2        NULL,
        delivery_end               datetime2        NULL,
        reference_no               nvarchar(40)     NULL,
        shipper_name               nvarchar(100)    NULL,
        shipper_address            nvarchar(200)    NULL,
        shipper_phone              varchar(30)      NULL,
        consignee_name             nvarchar(100)    NULL,
        consignee_address          nvarchar(200)    NULL,
        consignee_phone            varchar(30)      NULL,
        commodity                  nvarchar(100)    NULL,
        weight_lbs                 int              NULL,
        pieces                     int              NULL,
        hazmat                     bit              NOT NULL CONSTRAINT DF_Loads_hazmat DEFAULT ((0)),
        temp_f                     smallint         NULL,
        notes                      nvarchar(1000)   NULL,
        created_utc                datetime2        NOT NULL CONSTRAINT DF_Loads_created_utc DEFAULT (sysutcdatetime()),
        created_by                 nvarchar(256)    NULL,
        updated_utc                datetime2        NULL,
        updated_by                 nvarchar(256)    NULL,
        trailer_no                 varchar(20)      NULL,
        customer_organization_uuid uniqueidentifier NULL,
        empty_miles                int              NOT NULL CONSTRAINT DF_Loads_empty_miles DEFAULT ((0)),
        invoice_id                 int              NULL
    );
    PRINT 'TMS.Loads created, empty. Fill it with loads_to_tms.sql''s output, as on the host.';
END

-- The lookup tables, as the app made them: Id from 0, the Undefined
-- placeholder first, the rest in the order they were created.
IF OBJECT_ID(N'DRVR.fk_get_me_home_status', N'U') IS NULL
BEGIN
    CREATE TABLE DRVR.fk_get_me_home_status (
        fk_get_me_home_status_Id int IDENTITY(0,1) NOT NULL CONSTRAINT PK_fk_get_me_home_status PRIMARY KEY,
        fk_get_me_home_status varchar(255) NOT NULL CONSTRAINT DF_fk_get_me_home_status_Name DEFAULT ('Undefined'),
        Choice_Key varchar(6) NULL, IsActive int NULL CONSTRAINT DF_fk_get_me_home_status_IsActive DEFAULT ((1)),
        Created_At datetime NULL CONSTRAINT DF_fk_get_me_home_status_Created_At DEFAULT (getdate()), Updated_At datetime NULL CONSTRAINT DF_fk_get_me_home_status_Updated_At DEFAULT (getdate()),
        Created_By uniqueidentifier NULL, j int NOT NULL CONSTRAINT DF_fk_get_me_home_status_j DEFAULT ((1)), TTP_ID int NULL CONSTRAINT DF_fk_get_me_home_status_TTP_ID DEFAULT ((0)));
    SET IDENTITY_INSERT DRVR.fk_get_me_home_status ON;
    INSERT DRVR.fk_get_me_home_status (fk_get_me_home_status_Id, fk_get_me_home_status, Choice_Key, IsActive, Created_At, Updated_At, Created_By, j, TTP_ID) VALUES
        (0, 'Undefined', '-', 1, '2026-09-29T14:18:34.433', '2026-09-29T14:18:34.433', NULL, 1, 0),
        (1, 'LATE', 'a', 1, '2026-09-29T14:21:44.127', '2026-09-29T14:21:44.127', NULL, 1, 0),
        (2, 'TIGHT', 'b', 1, '2026-09-29T14:24:43.883', '2026-09-29T14:24:43.883', NULL, 1, 0),
        (3, 'OVERDUE', 'c', 1, '2026-09-29T14:24:55.173', '2026-09-29T14:24:55.173', NULL, 1, 0),
        (4, 'NOLOCATION', 'd', 1, '2026-09-29T14:25:25.770', '2026-09-29T14:25:25.770', NULL, 1, 0),
        (5, 'SOON', 'e', 1, '2026-09-29T14:25:38.583', '2026-09-29T14:25:38.583', NULL, 1, 0),
        (6, 'ONTRACK', 'f', 1, '2026-09-29T14:25:51.017', '2026-09-29T14:25:51.017', NULL, 1, 0),
        (7, 'ONTHEROAD', 'g', 1, '2026-09-29T14:26:03.017', '2026-09-29T14:26:03.017', NULL, 1, 0),
        (8, 'HOME', 'h', 1, '2026-09-29T14:26:14.670', '2026-09-29T14:26:14.670', NULL, 1, 0);
    SET IDENTITY_INSERT DRVR.fk_get_me_home_status OFF;
    PRINT 'DRVR.fk_get_me_home_status: 9 rows, as created through the app.';
END
IF OBJECT_ID(N'DRVR.fk_Home_Time_Status', N'U') IS NULL
BEGIN
    CREATE TABLE DRVR.fk_Home_Time_Status (
        Home_Time_Status_Id int IDENTITY(0,1) NOT NULL CONSTRAINT PK_fk_Home_Time_Status PRIMARY KEY,
        Home_Time_Status varchar(255) NOT NULL CONSTRAINT DF_fk_Home_Time_Status_Name DEFAULT ('Undefined'),
        Choice_Key varchar(6) NULL, IsActive int NULL CONSTRAINT DF_fk_Home_Time_Status_IsActive DEFAULT ((1)),
        Created_At datetime NULL CONSTRAINT DF_fk_Home_Time_Status_Created_At DEFAULT (getdate()), Updated_At datetime NULL CONSTRAINT DF_fk_Home_Time_Status_Updated_At DEFAULT (getdate()),
        Created_By uniqueidentifier NULL, j int NOT NULL CONSTRAINT DF_fk_Home_Time_Status_j DEFAULT ((1)), TTP_ID int NULL CONSTRAINT DF_fk_Home_Time_Status_TTP_ID DEFAULT ((0)));
    SET IDENTITY_INSERT DRVR.fk_Home_Time_Status ON;
    INSERT DRVR.fk_Home_Time_Status (Home_Time_Status_Id, Home_Time_Status, Choice_Key, IsActive, Created_At, Updated_At, Created_By, j, TTP_ID) VALUES
        (0, 'Undefined', '-', 1, '2026-09-29T15:43:24.813', '2026-09-29T15:43:24.813', NULL, 1, 0),
        (1, 'REQUESTED', 'a', 1, '2026-09-29T15:43:48.430', '2026-09-29T15:43:48.430', NULL, 1, 0),
        (2, 'APPROVED', 'b', 1, '2026-09-29T15:44:02.610', '2026-09-29T15:44:02.610', NULL, 1, 0),
        (3, 'HOME', 'c', 1, '2026-09-29T15:44:18.713', '2026-09-29T15:44:18.713', NULL, 1, 0),
        (4, 'DONE', 'd', 1, '2026-09-29T15:44:28.767', '2026-09-29T15:44:28.767', NULL, 1, 0),
        (5, 'DECLINED', 'e', 1, '2026-09-29T15:44:38.993', '2026-09-29T15:44:38.993', NULL, 1, 0),
        (6, 'CANCELLED', 'f', 1, '2026-09-29T15:44:49.247', '2026-09-29T15:44:49.247', NULL, 1, 0);
    SET IDENTITY_INSERT DRVR.fk_Home_Time_Status OFF;
    PRINT 'DRVR.fk_Home_Time_Status: 7 rows, as created through the app.';
END
IF OBJECT_ID(N'DRVR.fk_Home_Time_Source', N'U') IS NULL
BEGIN
    CREATE TABLE DRVR.fk_Home_Time_Source (
        Home_Time_Source_Id int IDENTITY(0,1) NOT NULL CONSTRAINT PK_fk_Home_Time_Source PRIMARY KEY,
        Home_Time_Source varchar(255) NOT NULL CONSTRAINT DF_fk_Home_Time_Source_Name DEFAULT ('Undefined'),
        Choice_Key varchar(6) NULL, IsActive int NULL CONSTRAINT DF_fk_Home_Time_Source_IsActive DEFAULT ((1)),
        Created_At datetime NULL CONSTRAINT DF_fk_Home_Time_Source_Created_At DEFAULT (getdate()), Updated_At datetime NULL CONSTRAINT DF_fk_Home_Time_Source_Updated_At DEFAULT (getdate()),
        Created_By uniqueidentifier NULL, j int NOT NULL CONSTRAINT DF_fk_Home_Time_Source_j DEFAULT ((1)), TTP_ID int NULL CONSTRAINT DF_fk_Home_Time_Source_TTP_ID DEFAULT ((0)));
    SET IDENTITY_INSERT DRVR.fk_Home_Time_Source ON;
    INSERT DRVR.fk_Home_Time_Source (Home_Time_Source_Id, Home_Time_Source, Choice_Key, IsActive, Created_At, Updated_At, Created_By, j, TTP_ID) VALUES
        (0, 'Undefined', '-', 1, '2026-09-29T17:12:13.020', '2026-09-29T17:12:13.020', NULL, 1, 0),
        (1, 'DISPATCH', 'a', 1, '2026-09-29T17:12:40.103', '2026-09-29T17:12:40.103', NULL, 1, 0),
        (2, 'GEOTAB', 'b', 1, '2026-09-29T17:12:51.313', '2026-09-29T17:12:51.313', NULL, 1, 0),
        (3, 'OTHER', 'c', 1, '2026-09-29T17:13:00.757', '2026-09-29T17:13:00.757', NULL, 1, 0);
    SET IDENTITY_INSERT DRVR.fk_Home_Time_Source OFF;
    PRINT 'DRVR.fk_Home_Time_Source: 4 rows, as created through the app.';
END
IF OBJECT_ID(N'DRVR.fk_Load_Plan_Status', N'U') IS NULL
BEGIN
    CREATE TABLE DRVR.fk_Load_Plan_Status (
        Load_Plan_Status_Id int IDENTITY(0,1) NOT NULL CONSTRAINT PK_fk_Load_Plan_Status PRIMARY KEY,
        Load_Plan_Status varchar(255) NOT NULL CONSTRAINT DF_fk_Load_Plan_Status_Name DEFAULT ('Undefined'),
        Choice_Key varchar(6) NULL, IsActive int NULL CONSTRAINT DF_fk_Load_Plan_Status_IsActive DEFAULT ((1)),
        Created_At datetime NULL CONSTRAINT DF_fk_Load_Plan_Status_Created_At DEFAULT (getdate()), Updated_At datetime NULL CONSTRAINT DF_fk_Load_Plan_Status_Updated_At DEFAULT (getdate()),
        Created_By uniqueidentifier NULL, j int NOT NULL CONSTRAINT DF_fk_Load_Plan_Status_j DEFAULT ((1)), TTP_ID int NULL CONSTRAINT DF_fk_Load_Plan_Status_TTP_ID DEFAULT ((0)));
    SET IDENTITY_INSERT DRVR.fk_Load_Plan_Status ON;
    INSERT DRVR.fk_Load_Plan_Status (Load_Plan_Status_Id, Load_Plan_Status, Choice_Key, IsActive, Created_At, Updated_At, Created_By, j, TTP_ID) VALUES
        (0, 'Undefined', '-', 1, '2026-09-29T19:07:58.110', '2026-09-29T19:07:58.110', NULL, 1, 0),
        (1, 'PLANNED', 'a', 1, '2026-09-29T19:08:10.517', '2026-09-29T19:08:10.517', NULL, 1, 0),
        (2, 'TAKEN_BACK', 'b', 1, '2026-09-29T19:08:22.930', '2026-09-29T19:08:22.930', NULL, 1, 0);
    SET IDENTITY_INSERT DRVR.fk_Load_Plan_Status OFF;
    PRINT 'DRVR.fk_Load_Plan_Status: 3 rows, as created through the app.';
END

PRINT 'Stand-in ready. Next, here in mvp-techgacity: 01, the drivers copy, 02, 04, the loads copy, then the load plans seed.';
