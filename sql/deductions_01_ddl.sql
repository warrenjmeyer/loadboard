-- deductions_01_ddl.sql
-- What comes out of a driver's settlement every week, as a standing order.
--
-- The pay run (loads_05_payrun.sql, /payroll) generates route pay and
-- nothing else, which for an owner/operator is a gross figure: the truck
-- payment, the insurance, the trailer rent, the fuel card and the escrow
-- contributions all come out before anything is paid, and every one of them
-- is the same every week. This table is that list, per driver. The pay run
-- reads it and writes the SettlementLines and SettlementEscrow rows the
-- statement already knows how to print.
--
-- A deduction is either FLAT (so much per settlement) or PER_MILE (so much
-- for every mile the settlement pays, which is how a fuel card is settled).
-- One with an escrow_code is a contribution to an account the carrier holds
-- for the driver: it is deducted AND the account's running balance moves,
-- beginning from the driver's last statement or from escrow_opening if there
-- is none. One with a balance is a loan -- an advance being repaid -- and
-- stops by itself when the balance reaches zero, taking less than the usual
-- amount on the last week.
--
-- Amounts are stored POSITIVE: "712.00 a week", the way a person says it.
-- The pay run negates them into the line, where the sign convention is
-- "signed as it should be added" (settlement_01_ddl.sql).
--
-- Run as sqlmillstream (db_owner). Requires settlement_06_owner.sql. Safe to
-- re-run: guarded, and the seed MERGEs on driver + code.

SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.DriverDeductions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.DriverDeductions (
        deduction_id    INT IDENTITY(1,1) NOT NULL,
        driver_code     VARCHAR(20)   NOT NULL,
        code            VARCHAR(20)   NOT NULL,   -- the RATECODE on the line: TRUCKPAY, FUEL, MAINT
        description     NVARCHAR(120) NOT NULL,   -- what the statement prints
        basis           VARCHAR(10)   NOT NULL CONSTRAINT DF_Deductions_basis DEFAULT 'FLAT',
        amount          DECIMAL(12,4) NOT NULL,   -- per settlement, or per mile; 4 dp for a per-mile rate

        escrow_code     VARCHAR(20)   NULL,       -- set: this is a contribution to that account
        escrow_opening  DECIMAL(12,2) NULL,       -- the balance to start from when no statement has one yet

        balance         DECIMAL(12,2) NULL,       -- set: a loan; what is still owed

        start_date      DATE          NULL,       -- first check date it applies to; NULL = already
        end_date        DATE          NULL,       -- last check date it applies to; NULL = open-ended
        active          BIT           NOT NULL CONSTRAINT DF_Deductions_active DEFAULT 1,
        notes           NVARCHAR(400) NULL,

        created_utc     DATETIME2(0)  NOT NULL CONSTRAINT DF_Deductions_created DEFAULT SYSUTCDATETIME(),
        updated_utc     DATETIME2(0)  NULL,
        updated_by      NVARCHAR(256) NULL,

        CONSTRAINT PK_DriverDeductions PRIMARY KEY (deduction_id),
        CONSTRAINT FK_Deductions_driver FOREIGN KEY (driver_code) REFERENCES dbo.Drivers (driver_code),
        -- One standing order per code per driver. A second TRUCKPAY row is a
        -- double deduction, not a second truck.
        CONSTRAINT UQ_Deductions_driver_code UNIQUE (driver_code, code),
        CONSTRAINT CK_Deductions_basis CHECK (basis IN ('FLAT', 'PER_MILE')),
        CONSTRAINT CK_Deductions_amount CHECK (amount > 0),
        CONSTRAINT CK_Deductions_balance CHECK (balance IS NULL OR balance >= 0),
        CONSTRAINT CK_Deductions_opening CHECK (escrow_opening IS NULL OR escrow_opening >= 0),
        CONSTRAINT CK_Deductions_dates CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
    );
    PRINT 'CREATED dbo.DriverDeductions';
END
ELSE
    PRINT 'dbo.DriverDeductions already exists';
GO

------------------------------------------------------------------------------
-- Seed: the four owner/operators' standing orders, exactly the lines their
-- seeded statements carry (tools/gen_owner_settlements.mjs). Fuel is per
-- mile at the generator's 0.592; the escrow contributions continue the
-- balances the last seeded statement left.
--
-- One thing the seed did that this does NOT copy: the seeded statements
-- moved the escrow balances without a matching deduction line, so those
-- contributions came from nowhere. Here a contribution is a deduction AND a
-- balance movement, because that is where the money comes from.
------------------------------------------------------------------------------
MERGE dbo.DriverDeductions AS target
USING (
    SELECT d.driver_code, s.code, s.description, s.basis, s.amount, s.escrow_code, s.escrow_opening
    FROM dbo.Drivers AS d
    CROSS JOIN (VALUES
        ('FUEL',     N'FUEL - COMCHEK',        'PER_MILE',   0.5920, NULL,    NULL),
        ('TRUCKPAY', N'TRUCK PAYMENT',         'FLAT',     712.0000, NULL,    NULL),
        ('OCCACC',   N'OCC/ACC INSURANCE',     'FLAT',      68.5000, NULL,    NULL),
        ('PHYSDAM',  N'PHYSICAL DAMAGE INS',   'FLAT',      94.2500, NULL,    NULL),
        ('TRLRENT',  N'TRAILER RENT',          'FLAT',     175.0000, NULL,    NULL),
        ('ELD',      N'ELD SUBSCRIPTION',      'FLAT',      32.0000, NULL,    NULL),
        ('MAINT',    N'MAINTENANCE ESCROW',    'FLAT',     125.0000, 'MAINT', 2400.00),
        ('TIRE',     N'TIRE ESCROW',           'FLAT',      75.0000, 'TIRE',   860.00)
    ) AS s (code, description, basis, amount, escrow_code, escrow_opening)
    WHERE d.driver_type = 'OWNER'
) AS source
ON target.driver_code = source.driver_code AND target.code = source.code
WHEN NOT MATCHED THEN
    INSERT (driver_code, code, description, basis, amount, escrow_code, escrow_opening)
    VALUES (source.driver_code, source.code, source.description, source.basis, source.amount, source.escrow_code, source.escrow_opening);
DECLARE @n INT = (SELECT COUNT(*) FROM dbo.DriverDeductions);
PRINT 'Standing deductions: ' + CAST(@n AS varchar(10));
GO

SELECT 'DriverDeductions' AS item, (SELECT COUNT(*) FROM dbo.DriverDeductions) AS present
UNION ALL SELECT 'Drivers with any', (SELECT COUNT(DISTINCT driver_code) FROM dbo.DriverDeductions);
GO
