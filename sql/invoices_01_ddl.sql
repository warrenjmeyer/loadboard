-- invoices_01_ddl.sql
-- The customer side of the money.
--
-- The pay run (loads_05_payrun.sql, api/src/payrunRules.js) turned delivered
-- loads into what the carrier OWES its drivers. Nothing yet said what the
-- carrier is OWED. This adds it: a delivered load becomes a line on an
-- invoice to its customer, at the load's rate, plus every accessorial marked
-- bill_customer at its bill_amount, due after the customer's payment terms.
--
-- Two tables, shaped like Settlements / SettlementRoutes:
--
--   dbo.Invoices       one per customer per run: number, dates, total,
--                      what has been paid against it, and a status
--   dbo.InvoiceLines   one per load (the line haul) and one per billed
--                      charge, each naming its load
--
-- and two MARKER columns, the same device as SettlementRoutes.load_id and
-- LoadCharges.settlement_line_id:
--
--   Loads.invoice_id             the invoice this load's line haul is on
--   LoadCharges.invoice_line_id  the line this charge is on
--
-- "Unbilled" is then a NULL test, which is the whole reason for the
-- markers: an EXISTS across a join that also has to exclude voided
-- invoices is the kind of query that is right in three places and wrong
-- in the fourth.
--
-- An invoice is never deleted. It is VOIDED: status goes to Void, the
-- markers on its loads and charges are cleared in the same transaction,
-- and the number stays on record. Invoice numbers that vanish are how an
-- auditor's morning gets ruined, and it also means no ON DELETE actions
-- are needed here -- which matters, because Loads, LoadCharges,
-- Invoices and InvoiceLines would otherwise form exactly the multiple
-- cascade path SQL Server refuses.
--
-- The bill-to name and address are COPIED onto the invoice. A customer
-- that moves next year does not retroactively change where last year's
-- invoices said they were sent.
--
-- Run as sqlmillstream (db_owner). Requires customers_01_ddl.sql and
-- charges_01_ddl.sql. Safe to re-run: guarded, and the seed skips loads
-- already on an invoice.

SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.Invoices', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Invoices (
        invoice_id       INT IDENTITY(1,1) NOT NULL,
        invoice_no       VARCHAR(20)   NOT NULL,   -- INV-260911-0001: date, then sequence within it
        customer_id      INT           NOT NULL,
        invoice_date     DATE          NOT NULL,
        due_date         DATE          NOT NULL,
        terms_days       SMALLINT      NOT NULL,   -- as they were on the day; the customer's may change

        bill_to_name     NVARCHAR(100) NOT NULL,
        bill_to_address  NVARCHAR(300) NULL,

        -- Open   sent, not fully paid
        -- Paid   paid_amount covers total
        -- Void   cancelled; its loads and charges are billable again
        status           VARCHAR(10)   NOT NULL CONSTRAINT DF_Invoices_status DEFAULT 'Open',
        total            DECIMAL(12,2) NOT NULL,
        paid_amount      DECIMAL(12,2) NOT NULL CONSTRAINT DF_Invoices_paid DEFAULT 0,
        paid_date        DATE          NULL,       -- the last payment's
        notes            NVARCHAR(500) NULL,

        created_utc      DATETIME2(0)  NOT NULL CONSTRAINT DF_Invoices_created DEFAULT SYSUTCDATETIME(),
        created_by       NVARCHAR(256) NULL,
        updated_utc      DATETIME2(0)  NULL,
        updated_by       NVARCHAR(256) NULL,

        CONSTRAINT PK_Invoices PRIMARY KEY (invoice_id),
        CONSTRAINT UQ_Invoices_no UNIQUE (invoice_no),
        CONSTRAINT FK_Invoices_customer FOREIGN KEY (customer_id) REFERENCES dbo.Customers (customer_id),
        CONSTRAINT CK_Invoices_status CHECK (status IN ('Open', 'Paid', 'Void')),
        CONSTRAINT CK_Invoices_total CHECK (total >= 0),
        CONSTRAINT CK_Invoices_paid CHECK (paid_amount >= 0),
        CONSTRAINT CK_Invoices_due CHECK (due_date >= invoice_date)
    );
    CREATE INDEX IX_Invoices_customer ON dbo.Invoices (customer_id, status);
    CREATE INDEX IX_Invoices_date ON dbo.Invoices (invoice_date);
    PRINT 'CREATED dbo.Invoices';
END
ELSE
    PRINT 'dbo.Invoices already exists';
GO

IF OBJECT_ID(N'dbo.InvoiceLines', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.InvoiceLines (
        line_id      INT IDENTITY(1,1) NOT NULL,
        invoice_id   INT           NOT NULL,
        load_id      VARCHAR(20)   NOT NULL,
        line_type    VARCHAR(10)   NOT NULL,   -- LINEHAUL or CHARGE
        description  NVARCHAR(200) NOT NULL,   -- "DUBUQUE, IA - CHICAGO, IL" or "DETENTION - 2 HRS"
        amount       DECIMAL(12,2) NOT NULL,

        CONSTRAINT PK_InvoiceLines PRIMARY KEY (line_id),
        CONSTRAINT FK_InvoiceLines_invoice FOREIGN KEY (invoice_id) REFERENCES dbo.Invoices (invoice_id),
        CONSTRAINT FK_InvoiceLines_load FOREIGN KEY (load_id) REFERENCES dbo.Loads (id),
        CONSTRAINT CK_InvoiceLines_type CHECK (line_type IN ('LINEHAUL', 'CHARGE')),
        CONSTRAINT CK_InvoiceLines_amount CHECK (amount >= 0)
    );
    CREATE INDEX IX_InvoiceLines_invoice ON dbo.InvoiceLines (invoice_id);
    CREATE INDEX IX_InvoiceLines_load ON dbo.InvoiceLines (load_id);
    PRINT 'CREATED dbo.InvoiceLines';
END
ELSE
    PRINT 'dbo.InvoiceLines already exists';
GO

IF COL_LENGTH(N'dbo.Loads', N'invoice_id') IS NULL
BEGIN
    ALTER TABLE dbo.Loads ADD invoice_id INT NULL;
    PRINT 'ADDED Loads.invoice_id';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Loads_invoice')
BEGIN
    ALTER TABLE dbo.Loads ADD CONSTRAINT FK_Loads_invoice
        FOREIGN KEY (invoice_id) REFERENCES dbo.Invoices (invoice_id);
    PRINT 'ADDED FK_Loads_invoice';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Loads_unbilled' AND object_id = OBJECT_ID(N'dbo.Loads'))
BEGIN
    CREATE INDEX IX_Loads_unbilled ON dbo.Loads (customer_id, delivered_date)
        INCLUDE (rate, status) WHERE invoice_id IS NULL;
END
GO

IF COL_LENGTH(N'dbo.LoadCharges', N'invoice_line_id') IS NULL
BEGIN
    ALTER TABLE dbo.LoadCharges ADD invoice_line_id INT NULL;
    PRINT 'ADDED LoadCharges.invoice_line_id';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Charges_invoice_line')
BEGIN
    ALTER TABLE dbo.LoadCharges ADD CONSTRAINT FK_Charges_invoice_line
        FOREIGN KEY (invoice_line_id) REFERENCES dbo.InvoiceLines (line_id);
    PRINT 'ADDED FK_Charges_invoice_line';
END
GO

------------------------------------------------------------------------------
-- Seed: the history.
--
-- The seeded delivered loads (L-300xx, L-310xx, August 2026) were all paid
-- to drivers before this app could invoice anyone, and without this block
-- the first invoice run would bill six customers for a month of freight in
-- one go. So the loads delivered BEFORE 1 September are put on invoices
-- here, one per customer per delivered week, dated the Monday after, the
-- way a billing clerk would have done it -- and marked paid, on time, except
-- Riverbend's, which stay open. Riverbend is the customer on Hold; an
-- accounts-receivable page with nobody behind on anything would be a poor
-- demonstration of one.
--
-- Only loads with a customer_id and no invoice_id are touched, so a re-run
-- adds nothing, and a load somebody has already invoiced through the app is
-- left where it is. Charges are NOT seeded onto these invoices: an unbilled
-- charge on a billed load is the "straggler" case the next run picks up on
-- its own, and leaving any that exist for it to find is the honest seed.
------------------------------------------------------------------------------
IF OBJECT_ID(N'tempdb..#inv') IS NOT NULL DROP TABLE #inv;

-- 2026-01-04 is a Sunday. A week ends on the Saturday on or after the
-- delivered date; the invoice goes out the Monday after that.
SELECT l.customer_id,
       DATEADD(DAY, 6 - ((DATEDIFF(DAY, '2026-01-04', l.delivered_date) % 7) + 7) % 7, l.delivered_date) AS week_end,
       CAST(NULL AS DATE)        AS invoice_date,
       CAST(NULL AS VARCHAR(20)) AS invoice_no,
       SUM(l.rate)               AS total,
       COUNT(*)                  AS load_count
  INTO #inv
  FROM dbo.Loads AS l
 WHERE l.status = N'Delivered'
   AND l.customer_id IS NOT NULL
   AND l.invoice_id IS NULL
   AND l.delivered_date < '2026-09-01'
 GROUP BY l.customer_id,
          DATEADD(DAY, 6 - ((DATEDIFF(DAY, '2026-01-04', l.delivered_date) % 7) + 7) % 7, l.delivered_date);

UPDATE #inv SET invoice_date = DATEADD(DAY, 2, week_end);

-- Numbers: INV-yyMMdd-NNNN, sequence within the date, continuing past any
-- the app has already issued on that date.
;WITH numbered AS (
    SELECT t.invoice_no, t.invoice_date,
           ROW_NUMBER() OVER (PARTITION BY t.invoice_date ORDER BY t.customer_id) AS rn,
           ISNULL((SELECT MAX(TRY_CAST(RIGHT(i.invoice_no, 4) AS INT)) FROM dbo.Invoices AS i WHERE i.invoice_date = t.invoice_date), 0) AS already
      FROM #inv AS t
)
UPDATE numbered
   SET invoice_no = 'INV-' + FORMAT(invoice_date, 'yyMMdd') + '-' + RIGHT('0000' + CAST(rn + already AS VARCHAR(4)), 4);

INSERT INTO dbo.Invoices (invoice_no, customer_id, invoice_date, due_date, terms_days, bill_to_name, bill_to_address,
                          status, total, paid_amount, paid_date, notes, created_by)
SELECT t.invoice_no, t.customer_id, t.invoice_date,
       DATEADD(DAY, c.payment_terms_days, t.invoice_date), c.payment_terms_days,
       c.name,
       NULLIF(CONCAT_WS(', ', c.address1, c.city, CONCAT_WS(' ', c.state, c.postal_code)), ''),
       CASE WHEN c.status = 'Hold' THEN 'Open' ELSE 'Paid' END,
       t.total,
       CASE WHEN c.status = 'Hold' THEN 0 ELSE t.total END,
       CASE WHEN c.status = 'Hold' THEN NULL ELSE DATEADD(DAY, c.payment_terms_days - 3, t.invoice_date) END,
       N'Seeded from delivered loads before the app could invoice.',
       N'invoices_01_ddl.sql'
  FROM #inv AS t
  JOIN dbo.Customers AS c ON c.customer_id = t.customer_id;
DECLARE @invoices INT = @@ROWCOUNT;

UPDATE l
   SET l.invoice_id = i.invoice_id
  FROM dbo.Loads AS l
  JOIN #inv AS t ON t.customer_id = l.customer_id
              AND t.week_end = DATEADD(DAY, 6 - ((DATEDIFF(DAY, '2026-01-04', l.delivered_date) % 7) + 7) % 7, l.delivered_date)
  JOIN dbo.Invoices AS i ON i.invoice_no = t.invoice_no
 WHERE l.status = N'Delivered' AND l.invoice_id IS NULL AND l.delivered_date < '2026-09-01';
DECLARE @loads INT = @@ROWCOUNT;

INSERT INTO dbo.InvoiceLines (invoice_id, load_id, line_type, description, amount)
SELECT l.invoice_id, l.id, 'LINEHAUL', UPPER(l.origin + N' - ' + l.destination), l.rate
  FROM dbo.Loads AS l
  JOIN dbo.Invoices AS i ON i.invoice_id = l.invoice_id
 WHERE i.created_by = N'invoices_01_ddl.sql'
   AND NOT EXISTS (SELECT 1 FROM dbo.InvoiceLines AS x WHERE x.load_id = l.id AND x.invoice_id = l.invoice_id);
DECLARE @lines INT = @@ROWCOUNT;

DROP TABLE #inv;
PRINT 'Seeded ' + CAST(@invoices AS varchar(10)) + ' invoices covering ' + CAST(@loads AS varchar(10)) + ' loads (' + CAST(@lines AS varchar(10)) + ' lines)';
GO

------------------------------------------------------------------------------
-- What the schema now looks like
------------------------------------------------------------------------------
SELECT 'Invoices'          AS item, (SELECT COUNT(*) FROM dbo.Invoices) AS present
UNION ALL SELECT 'Open',              (SELECT COUNT(*) FROM dbo.Invoices WHERE status = 'Open')
UNION ALL SELECT 'InvoiceLines',      (SELECT COUNT(*) FROM dbo.InvoiceLines)
UNION ALL SELECT 'Loads billed',      (SELECT COUNT(*) FROM dbo.Loads WHERE invoice_id IS NOT NULL)
UNION ALL SELECT 'Delivered, unbilled, with a customer',
       (SELECT COUNT(*) FROM dbo.Loads WHERE status = N'Delivered' AND invoice_id IS NULL AND customer_id IS NOT NULL)
UNION ALL SELECT 'Delivered with no customer record',
       (SELECT COUNT(*) FROM dbo.Loads WHERE status = N'Delivered' AND customer_id IS NULL);
GO
