-- charges_01_ddl.sql
-- The money on a load that is not the rate: detention, layover, a stop-off,
-- the fuel surcharge, and what the driver paid out of pocket -- tolls, a
-- lumper, the scale, a wash-out.
--
-- Until now these existed only as seed rows in SettlementLines, typed in by
-- hand after the fact. They belong on the LOAD, entered when they happen --
-- the dispatcher when the shipper agrees to detention, the driver when they
-- hand over a lumper receipt -- and the pay run picks them up from there,
-- the same way it picks up the route pay.
--
-- Two kinds, matching SettlementLines.line_type:
--   REVENUE        extra pay to the driver: detention, layover, stop-off,
--                  fuel surcharge
--   REIMBURSEMENT  the driver's own money coming back: tolls, lumper, scale
--
-- Whether the CUSTOMER is billed for it is a separate question with its own
-- columns, because the two often differ: a lumper is billed back at cost
-- and detention is billed at the customer's rate, not the driver's.
--
-- A charge is PAID when settlement_line_id points at the line that paid it.
-- The pay run sets it; deleting the settlement clears it (ON DELETE SET
-- NULL), so a charge whose statement was undone becomes payable again by
-- itself. A charge added after its load was settled is a straggler and the
-- next run picks it up, on its own if need be.
--
-- Run as sqlmillstream (db_owner). Requires loads_04_dispatch.sql and
-- settlement_01_ddl.sql. Safe to re-run.

SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.LoadCharges', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.LoadCharges (
        charge_id          INT IDENTITY(1,1) NOT NULL,
        load_id            VARCHAR(20)   NOT NULL,
        line_type          VARCHAR(15)   NOT NULL,   -- REVENUE or REIMBURSEMENT
        code               VARCHAR(20)   NOT NULL,   -- DETENTION, LAYOVER, STOPOFF, FSC, TOLLS, LUMPER, SCALE, WASHOUT, OTHER
        description        NVARCHAR(120) NOT NULL,   -- what the statement prints: "DETENTION - 2 HRS"
        amount             DECIMAL(12,2) NOT NULL,   -- to the driver, positive

        bill_customer      BIT           NOT NULL CONSTRAINT DF_Charges_bill DEFAULT 0,
        bill_amount        DECIMAL(12,2) NULL,       -- what the customer is invoiced; NULL = same as amount

        receipt_note       NVARCHAR(200) NULL,       -- "Receipt #4471, Love's Joliet"
        settlement_line_id INT           NULL,       -- set by the pay run

        created_utc        DATETIME2(0)  NOT NULL CONSTRAINT DF_Charges_created DEFAULT SYSUTCDATETIME(),
        created_by         NVARCHAR(256) NULL,

        CONSTRAINT PK_LoadCharges PRIMARY KEY (charge_id),
        CONSTRAINT FK_Charges_load FOREIGN KEY (load_id) REFERENCES dbo.Loads (id) ON DELETE CASCADE,
        CONSTRAINT FK_Charges_line FOREIGN KEY (settlement_line_id) REFERENCES dbo.SettlementLines (line_id) ON DELETE SET NULL,
        CONSTRAINT CK_Charges_type CHECK (line_type IN ('REVENUE', 'REIMBURSEMENT')),
        CONSTRAINT CK_Charges_amount CHECK (amount > 0),
        CONSTRAINT CK_Charges_bill CHECK (bill_amount IS NULL OR bill_amount >= 0)
    );

    CREATE INDEX IX_Charges_load ON dbo.LoadCharges (load_id);
    CREATE INDEX IX_Charges_unpaid ON dbo.LoadCharges (settlement_line_id) WHERE settlement_line_id IS NULL;
    PRINT 'CREATED dbo.LoadCharges';
END
ELSE
    PRINT 'dbo.LoadCharges already exists';
GO

SELECT 'LoadCharges' AS item, (SELECT COUNT(*) FROM dbo.LoadCharges) AS present;
GO
