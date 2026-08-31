-- settlement_01_ddl.sql
-- Tables behind the company-driver settlement (pay statement).
--
-- Modelled on the DB2 tables the original ColdFusion page read:
--   HMLDATADB2.COMPANY_ROUTE            -> dbo.SettlementRoutes
--   HMLDATADB2.CODRIVERS_REVENUE        -\
--   HMLDATADB2.CODRIVERS_DEDUCTIONS      |-> dbo.SettlementLines
--   HMLDATADB2.CODRIVERS_REIMBURSMENTS  -/
--
-- The three revenue/deduction/reimbursement tables are collapsed into one
-- SettlementLines table with a LineType column, because the original page
-- immediately UNIONed them back together (the qDedReimRev query) and then
-- filtered by type. One table with a discriminator says the same thing
-- without the union, and keeps the sign convention in a single place.
--
-- Money is DECIMAL, never FLOAT. Binary floating point cannot represent 0.10
-- exactly, and a settlement that is off by a cent is a settlement nobody
-- trusts.
--
-- Run as sqlmillstream (db_owner). Safe to re-run: everything is guarded.

------------------------------------------------------------------------------
-- Drivers
------------------------------------------------------------------------------
IF OBJECT_ID(N'dbo.Drivers', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Drivers (
        driver_code    VARCHAR(20)   NOT NULL,
        first_name     NVARCHAR(50)  NOT NULL,
        last_name      NVARCHAR(50)  NOT NULL,
        address1       NVARCHAR(100) NOT NULL,
        address2       NVARCHAR(100) NULL,
        city           NVARCHAR(60)  NOT NULL,
        state          NCHAR(2)      NOT NULL,
        postal_code    VARCHAR(10)   NOT NULL,
        country        NVARCHAR(40)  NOT NULL CONSTRAINT DF_Drivers_country DEFAULT N'USA',

        -- Last four only. The original printed a full SSN on the company
        -- statement; the owner/operator page masked it to ***-**-1234. There is
        -- no reason to store more than the driver needs to recognise the
        -- statement as theirs.
        ssn_last4      CHAR(4)       NOT NULL,

        job            NVARCHAR(60)  NOT NULL,
        pay_rate       DECIMAL(9,4)  NOT NULL,   -- dollars per mile, 4 dp like the source
        pay_frequency  CHAR(1)       NOT NULL CONSTRAINT DF_Drivers_payfreq DEFAULT 'W',
        pay_group      NVARCHAR(20)  NOT NULL,
        location       NVARCHAR(60)  NOT NULL,
        department     NVARCHAR(60)  NOT NULL,
        job_type       NVARCHAR(60)  NOT NULL,

        CONSTRAINT PK_Drivers PRIMARY KEY (driver_code),
        CONSTRAINT CK_Drivers_payrate CHECK (pay_rate >= 0),
        CONSTRAINT CK_Drivers_payfreq CHECK (pay_frequency IN ('W', 'B', 'S', 'M'))
    );
END
GO

------------------------------------------------------------------------------
-- Settlements -- one row per driver per check date
------------------------------------------------------------------------------
IF OBJECT_ID(N'dbo.Settlements', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Settlements (
        settlement_id  INT IDENTITY(1,1) NOT NULL,
        driver_code    VARCHAR(20)   NOT NULL,
        check_date     DATE          NOT NULL,
        period_start   DATE          NOT NULL,
        period_end     DATE          NOT NULL,
        document_no    VARCHAR(20)   NOT NULL,   -- the CheckID on the printed statement

        CONSTRAINT PK_Settlements PRIMARY KEY (settlement_id),

        -- A driver gets one settlement per check date. Enforcing it here means
        -- a double-loaded pay run fails loudly instead of silently doubling
        -- someone's pay.
        CONSTRAINT UQ_Settlements_driver_date UNIQUE (driver_code, check_date),
        CONSTRAINT FK_Settlements_driver FOREIGN KEY (driver_code)
            REFERENCES dbo.Drivers (driver_code),
        CONSTRAINT CK_Settlements_period CHECK (period_end >= period_start)
    );
END
GO

------------------------------------------------------------------------------
-- SettlementRoutes -- the "Earnings by load" lines
------------------------------------------------------------------------------
IF OBJECT_ID(N'dbo.SettlementRoutes', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SettlementRoutes (
        route_id       INT IDENTITY(1,1) NOT NULL,
        settlement_id  INT           NOT NULL,

        -- 'SPECIAL' in the source when a paid route has no order number.
        order_no       VARCHAR(20)   NOT NULL,
        dispatch_no    VARCHAR(20)   NULL,
        unit_no        VARCHAR(20)   NULL,
        route_detail   NVARCHAR(200) NULL,       -- e.g. "DUBUQUE, IA - CHICAGO, IL"

        loaded_miles   INT           NOT NULL CONSTRAINT DF_Routes_loaded DEFAULT 0,
        empty_miles    INT           NOT NULL CONSTRAINT DF_Routes_empty  DEFAULT 0,
        total_miles    INT           NOT NULL CONSTRAINT DF_Routes_total  DEFAULT 0,

        -- Stored, not derived from the driver's current rate: a settlement is a
        -- historical record. Re-rating a driver must not silently rewrite what
        -- they were paid last March.
        pay_rate       DECIMAL(9,4)  NOT NULL,
        pay_amount     DECIMAL(12,2) NOT NULL,

        CONSTRAINT PK_SettlementRoutes PRIMARY KEY (route_id),
        CONSTRAINT FK_Routes_settlement FOREIGN KEY (settlement_id)
            REFERENCES dbo.Settlements (settlement_id) ON DELETE CASCADE,
        CONSTRAINT CK_Routes_miles CHECK (loaded_miles >= 0 AND empty_miles >= 0 AND total_miles >= 0)
    );

    CREATE INDEX IX_Routes_settlement ON dbo.SettlementRoutes (settlement_id);
END
GO

------------------------------------------------------------------------------
-- SettlementLines -- revenue, reimbursements and deductions
------------------------------------------------------------------------------
IF OBJECT_ID(N'dbo.SettlementLines', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SettlementLines (
        line_id        INT IDENTITY(1,1) NOT NULL,
        settlement_id  INT           NOT NULL,

        -- REVENUE      = pay that is not per-mile (minimum pay, bonuses)
        -- REIMBURSEMENT= money paid back to the driver (per diem, motel, tolls)
        -- DEDUCTION    = money withheld (advances, insurance, escrow)
        line_type      VARCHAR(15)   NOT NULL,

        order_no       VARCHAR(20)   NULL,       -- blank on a "SPECIAL" line
        code           VARCHAR(20)   NULL,       -- the source's RATECODE, e.g. PYMIN
        description    NVARCHAR(120) NOT NULL,
        advance_reference NVARCHAR(60) NULL,     -- shown beside advance deductions

        -- Signed as it should be added. Deductions are stored negative, so the
        -- net is a plain SUM and nothing downstream has to remember which way
        -- to flip a number. The original negated at query time in three
        -- different places and negated reimbursements too, which looks like an
        -- accident of the source data rather than intent.
        amount         DECIMAL(12,2) NOT NULL,

        CONSTRAINT PK_SettlementLines PRIMARY KEY (line_id),
        CONSTRAINT FK_Lines_settlement FOREIGN KEY (settlement_id)
            REFERENCES dbo.Settlements (settlement_id) ON DELETE CASCADE,
        CONSTRAINT CK_Lines_type CHECK (line_type IN ('REVENUE', 'REIMBURSEMENT', 'DEDUCTION')),
        CONSTRAINT CK_Lines_deduction_sign CHECK (line_type <> 'DEDUCTION' OR amount <= 0)
    );

    CREATE INDEX IX_Lines_settlement ON dbo.SettlementLines (settlement_id, line_type);
END
GO

-- Net pay is deliberately NOT a column. It is the sum of the route pay and the
-- lines, and storing it invites a stored value that disagrees with its own
-- detail. Compute it; if it ever needs to be frozen (because payroll actually
-- issued a cheque for a specific figure), add it then, with the reason.
