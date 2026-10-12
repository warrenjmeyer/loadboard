-- loads_01_ddl.sql
-- Table definition only. Requires CREATE TABLE in the target database --
-- hand this to a DBA / db_owner if your login is denied.
-- Adjust the schema name below if you are not creating this in dbo.

IF OBJECT_ID(N'dbo.Loads', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Loads (
        id          VARCHAR(20)   NOT NULL,
        origin      NVARCHAR(100) NOT NULL,
        destination NVARCHAR(100) NOT NULL,
        miles       INT           NOT NULL,
        rate        DECIMAL(10,2) NOT NULL,
        equipment   NVARCHAR(50)  NOT NULL,
        status      NVARCHAR(20)  NOT NULL,
        CONSTRAINT PK_Loads PRIMARY KEY (id),
        CONSTRAINT CK_Loads_miles  CHECK (miles > 0),
        CONSTRAINT CK_Loads_rate   CHECK (rate >= 0),
        CONSTRAINT CK_Loads_status CHECK (status IN (N'Available', N'Covered', N'Delivered'))
    );
END
GO

-- If a DBA is running this for you, they likely also need to grant you access:
-- GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.Loads TO [your_login_here];
