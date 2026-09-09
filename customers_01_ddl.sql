-- customers_01_ddl.sql
-- Who the freight belongs to, as a record rather than a name typed twice.
--
-- loads_04_dispatch.sql gave a load a customer_name and said, in its own
-- comment, that a table would come once there was a screen to manage one.
-- This is that table and this migration; the screen is /customers.
--
-- What a customer record is FOR, in a carrier this size: the phone number
-- and the person to call when a load goes wrong, the MC number a broker has
-- to have, the payment terms that decide when the invoice is due, and a
-- STATUS -- because the single most useful thing dispatch can know about a
-- broker is "do not take their freight, they have not paid for the last
-- three". A load for a customer on hold can be entered, but not covered.
--
-- Loads.customer_name stays. It is what the load said at the time and what
-- the API strips for anonymous callers; customer_id is the link. When a load
-- is given a customer_id the API copies the name across, so the two agree
-- from then on, and a load entered before this with a typed name keeps it.
--
-- Run as sqlmillstream (db_owner). Requires loads_04_dispatch.sql. Safe to
-- re-run: guarded, and the seed MERGEs on name.

SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.Customers', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Customers (
        customer_id       INT IDENTITY(1,1) NOT NULL,
        name              NVARCHAR(100) NOT NULL,

        -- Shipper   owns the freight and pays the carrier directly
        -- Broker    arranges it for a shipper and pays the carrier
        customer_type     VARCHAR(10)   NOT NULL CONSTRAINT DF_Customers_type DEFAULT 'Broker',
        mc_number         VARCHAR(12)   NULL,    -- brokers have one; shippers usually do not

        address1          NVARCHAR(100) NULL,
        city              NVARCHAR(60)  NULL,
        state             NCHAR(2)      NULL,
        postal_code       VARCHAR(10)   NULL,
        phone             VARCHAR(30)   NULL,
        email             NVARCHAR(254) NULL,
        contact_name      NVARCHAR(80)  NULL,

        -- Days from invoice to payment. 30 is the industry's default; a
        -- broker offering 15 is paying for volume, one asking 60 is a risk.
        payment_terms_days SMALLINT     NOT NULL CONSTRAINT DF_Customers_terms DEFAULT 30,
        credit_limit      DECIMAL(12,2) NULL,    -- NULL means nobody has set one

        -- Active    take their freight
        -- Hold      do not cover their loads until somebody clears it
        -- Inactive  no longer a customer; kept so old loads still resolve
        status            VARCHAR(10)   NOT NULL CONSTRAINT DF_Customers_status DEFAULT 'Active',
        notes             NVARCHAR(1000) NULL,

        created_utc       DATETIME2(0)  NOT NULL CONSTRAINT DF_Customers_created DEFAULT SYSUTCDATETIME(),
        updated_utc       DATETIME2(0)  NULL,
        updated_by        NVARCHAR(256) NULL,

        CONSTRAINT PK_Customers PRIMARY KEY (customer_id),
        CONSTRAINT UQ_Customers_name UNIQUE (name),
        CONSTRAINT CK_Customers_type CHECK (customer_type IN ('Shipper', 'Broker')),
        CONSTRAINT CK_Customers_status CHECK (status IN ('Active', 'Hold', 'Inactive')),
        CONSTRAINT CK_Customers_terms CHECK (payment_terms_days BETWEEN 0 AND 180),
        CONSTRAINT CK_Customers_credit CHECK (credit_limit IS NULL OR credit_limit >= 0)
    );
    PRINT 'CREATED dbo.Customers';
END
ELSE
    PRINT 'dbo.Customers already exists';
GO

IF COL_LENGTH(N'dbo.Loads', N'customer_id') IS NULL
BEGIN
    ALTER TABLE dbo.Loads ADD customer_id INT NULL;
    PRINT 'ADDED Loads.customer_id';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Loads_customer')
BEGIN
    ALTER TABLE dbo.Loads ADD CONSTRAINT FK_Loads_customer
        FOREIGN KEY (customer_id) REFERENCES dbo.Customers (customer_id);
    PRINT 'ADDED FK_Loads_customer';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Loads_customer' AND object_id = OBJECT_ID(N'dbo.Loads'))
BEGIN
    CREATE INDEX IX_Loads_customer ON dbo.Loads (customer_id) INCLUDE (status, rate, delivered_date);
END
GO

------------------------------------------------------------------------------
-- Seed: six customers, plainly fictional, shaped like the freight the board
-- already carries -- two food shippers for the reefers, a building-supply
-- shipper and a steel broker for the flatbeds, two general brokers for the
-- vans. One is on hold, so the rule has something to refuse.
------------------------------------------------------------------------------
MERGE dbo.Customers AS target
USING (VALUES
    (N'Mississippi Valley Foods',       'Shipper', NULL,        N'1200 Kerper Blvd',        N'Dubuque',      N'IA', '52001', '563-555-0140', N'dispatch@mvfoods.example',      N'Carla Jensen',   30, NULL,      'Active'),
    (N'Great Lakes Produce Co.',        'Shipper', NULL,        N'4400 W 41st St',          N'Chicago',      N'IL', '60632', '773-555-0188', N'inbound@glproduce.example',     N'Tom Adeyemi',    21, NULL,      'Active'),
    (N'Heartland Building Supply',      'Shipper', NULL,        N'2900 16th Ave SW',        N'Cedar Rapids', N'IA', '52404', '319-555-0122', N'shipping@heartlandbs.example',  N'Dana Whitcomb',  30, NULL,      'Active'),
    (N'Tri-State Steel Brokerage',      'Broker',  'MC-771204', N'600 Grand Ave Ste 210',   N'Des Moines',   N'IA', '50309', '515-555-0166', N'loads@tristatesteel.example',   N'Marcus Bell',    30, 25000.00,  'Active'),
    (N'Prairie Freight Partners',       'Broker',  'MC-655910', N'8100 W Dodge Rd',         N'Omaha',        N'NE', '68114', '402-555-0151', N'carriers@prairiefp.example',    N'Lupe Ortega',    15, 40000.00,  'Active'),
    (N'Riverbend Logistics LLC',        'Broker',  'MC-812377', N'55 E Monroe St',          N'Chicago',      N'IL', '60603', '312-555-0199', N'ap@riverbendlog.example',       N'Kevin Marsh',    45, 10000.00,  'Hold')
) AS source (name, customer_type, mc_number, address1, city, state, postal_code, phone, email, contact_name, payment_terms_days, credit_limit, status)
ON target.name = source.name
WHEN NOT MATCHED THEN
    INSERT (name, customer_type, mc_number, address1, city, state, postal_code, phone, email, contact_name, payment_terms_days, credit_limit, status, notes)
    VALUES (source.name, source.customer_type, source.mc_number, source.address1, source.city, source.state, source.postal_code, source.phone, source.email, source.contact_name, source.payment_terms_days, source.credit_limit, source.status,
            CASE WHEN source.status = 'Hold' THEN N'Two invoices past 60 days. Do not cover until AP confirms payment.' ELSE NULL END);
DECLARE @customers INT = (SELECT COUNT(*) FROM dbo.Customers);
PRINT 'Customers seeded: ' + CAST(@customers AS varchar(10));
GO

------------------------------------------------------------------------------
-- Give the existing loads a customer, deterministically, by what they haul:
-- reefers to the food shippers, flatbeds to steel and building supply, vans
-- to the two brokers. Only loads with NO customer yet -- a name somebody has
-- typed since loads_04 is theirs and is left alone. The name is copied
-- across so the two columns agree.
--
-- The split within a type goes by the last digit of the load number, which
-- is arbitrary and evenly spread, and that is the point: a customer page
-- with one customer owning every reefer load would be a poor demonstration
-- of a customer page.
------------------------------------------------------------------------------
UPDATE l
   SET l.customer_id = c.customer_id, l.customer_name = c.name
  FROM dbo.Loads AS l
  JOIN dbo.Customers AS c ON c.name = CASE
        WHEN l.equipment = N'Reefer'  AND RIGHT(l.id, 1) IN ('0','1','2','3','4') THEN N'Mississippi Valley Foods'
        WHEN l.equipment = N'Reefer'                                             THEN N'Great Lakes Produce Co.'
        WHEN l.equipment = N'Flatbed' AND RIGHT(l.id, 1) IN ('0','1','2','3','4') THEN N'Heartland Building Supply'
        WHEN l.equipment = N'Flatbed'                                            THEN N'Tri-State Steel Brokerage'
        WHEN RIGHT(l.id, 1) IN ('0','1','2','3','4','5','6')                     THEN N'Prairie Freight Partners'
        ELSE N'Riverbend Logistics LLC' END
 WHERE l.customer_id IS NULL AND l.customer_name IS NULL;
PRINT CAST(@@ROWCOUNT AS varchar(10)) + ' loads given a customer';
GO

------------------------------------------------------------------------------
-- What the schema now looks like
------------------------------------------------------------------------------
SELECT 'Customers'            AS item, (SELECT COUNT(*) FROM dbo.Customers) AS present
UNION ALL SELECT 'Loads with a customer', (SELECT COUNT(*) FROM dbo.Loads WHERE customer_id IS NOT NULL)
UNION ALL SELECT 'Loads without',        (SELECT COUNT(*) FROM dbo.Loads WHERE customer_id IS NULL)
UNION ALL SELECT 'FK_Loads_customer',    CASE WHEN EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Loads_customer') THEN 1 ELSE NULL END;
GO
