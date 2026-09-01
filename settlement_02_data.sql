-- settlement_02_data.sql
-- Sample settlements for the two Millstream drivers in GeoTab.
--
-- Driver identities come from the GeoTab "Advanced User List" export; the
-- company address (2633 Jackson Street, Dubuque, Iowa) is the one on that
-- account. Everything financial is invented: SSN last-four, pay rates, routes,
-- deductions. Nothing here is real pay data.
--
-- Unit numbers are the real MyGeotab vehicles each driver is assigned to
-- (geotab-assign-vehicles.ps1).
--
-- Re-runnable: it clears these drivers' settlements first, and the cascade on
-- SettlementRoutes/SettlementLines removes their children.
-- Requires settlement_01_ddl.sql to have run.

SET NOCOUNT ON;

DELETE FROM dbo.Settlements WHERE driver_code IN ('JSMITH', 'SOAKS');
GO

------------------------------------------------------------------------------
-- Drivers
------------------------------------------------------------------------------
MERGE dbo.Drivers AS target
USING (VALUES
    ('JSMITH', N'James',  N'Smith', N'2633 Jackson Street', NULL, N'Dubuque', N'IA', '52001', '4417',
     N'OTR Driver', 0.6200, 'W', N'HMLOTR', N'Dubuque, IA', N'Linehaul', N'Company Driver'),
    ('SOAKS',  N'Sherman', N'Oaks', N'2633 Jackson Street', NULL, N'Dubuque', N'IA', '52001', '8820',
     N'OTR Driver', 0.5800, 'W', N'HMLOTR', N'Dubuque, IA', N'Linehaul', N'Company Driver')
) AS source (driver_code, first_name, last_name, address1, address2, city, state, postal_code,
             ssn_last4, job, pay_rate, pay_frequency, pay_group, location, department, job_type)
ON target.driver_code = source.driver_code
WHEN MATCHED THEN UPDATE SET
    first_name = source.first_name, last_name = source.last_name,
    address1 = source.address1, address2 = source.address2, city = source.city,
    state = source.state, postal_code = source.postal_code, ssn_last4 = source.ssn_last4,
    job = source.job, pay_rate = source.pay_rate, pay_frequency = source.pay_frequency,
    pay_group = source.pay_group, location = source.location,
    department = source.department, job_type = source.job_type
WHEN NOT MATCHED THEN INSERT (driver_code, first_name, last_name, address1, address2, city, state,
    postal_code, ssn_last4, job, pay_rate, pay_frequency, pay_group, location, department, job_type)
VALUES (source.driver_code, source.first_name, source.last_name, source.address1, source.address2,
    source.city, source.state, source.postal_code, source.ssn_last4, source.job, source.pay_rate,
    source.pay_frequency, source.pay_group, source.location, source.department, source.job_type);
GO

DECLARE @sid INT;

------------------------------------------------------------------------------
-- JAMES SMITH -- week ending 08/22, paid 08/28
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('JSMITH', '2026-08-28', '2026-08-16', '2026-08-22', 'CK-260828-0015');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, load_id, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-10412', 'L-30001', 'D-44121', 'Demo - 15', N'DUBUQUE, IA - CHICAGO, IL',      182,  35,  217, 0.6200,  134.54),
    (@sid, 'O-10415', 'L-30002', 'D-44138', 'Demo - 15', N'CHICAGO, IL - DENVER, CO',      1003,  42, 1045, 0.6200,  647.90),
    (@sid, 'O-10418', 'L-30003', 'D-44155', 'Demo - 15', N'DENVER, CO - OMAHA, NE',         537,  18,  555, 0.6200,  344.10),
    (@sid, 'O-10421', 'L-30004', 'D-44170', 'Demo - 15', N'OMAHA, NE - DUBUQUE, IA',        372,  28,  400, 0.6200,  248.00);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE',       NULL,      NULL,    N'Wkly Sfty Incentive',  NULL,        50.00),
    (@sid, 'REVENUE',       NULL,      NULL,    N'Wkly Incentive Bonus', NULL,       125.00),
    (@sid, 'REIMBURSEMENT', NULL,      NULL,    N'PER DIEM - 4 DAYS',    NULL,       284.00),
    (@sid, 'REIMBURSEMENT', 'O-10415', NULL,    N'TOLLS',                NULL,        42.50),
    (@sid, 'REIMBURSEMENT', 'O-10418', NULL,    N'SCALE',                NULL,        14.00),
    (@sid, 'DEDUCTION',     NULL,      NULL,    N'MEDICAL INSURANCE',    NULL,       -87.50),
    (@sid, 'DEDUCTION',     NULL,      NULL,    N'ADVANCE',              N'CD-88213',-150.00),
    (@sid, 'DEDUCTION',     NULL,      NULL,    N'ESCROW',               NULL,       -50.00);
-- Settlement total: 1374.54 + 175.00 + 340.50 - 287.50 = 1602.54

------------------------------------------------------------------------------
-- JAMES SMITH -- week ending 08/15, paid 08/21
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('JSMITH', '2026-08-21', '2026-08-09', '2026-08-15', 'CK-260821-0015');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, load_id, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-10402', 'L-30005', 'D-43980', 'Demo - 15', N'DUBUQUE, IA - KANSAS CITY, MO',  322,  30,  352, 0.6200,  218.24),
    (@sid, 'O-10405', 'L-30006', 'D-43996', 'Demo - 15', N'KANSAS CITY, MO - DALLAS, TX',   552,  22,  574, 0.6200,  355.88),
    (@sid, 'O-10408', 'L-30007', 'D-44012', 'Demo - 15', N'DALLAS, TX - MEMPHIS, TN',       452,  40,  492, 0.6200,  305.04),
    (@sid, 'O-10410', 'L-30008', 'D-44030', 'Demo - 15', N'MEMPHIS, TN - DUBUQUE, IA',      612,  25,  637, 0.6200,  394.94);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE',       NULL,      NULL, N'Wkly Sfty Incentive', NULL,   50.00),
    (@sid, 'REIMBURSEMENT', NULL,      NULL, N'PER DIEM - 5 DAYS',   NULL,  355.00),
    (@sid, 'REIMBURSEMENT', 'O-10405', NULL, N'TOLLS',               NULL,   28.75),
    (@sid, 'DEDUCTION',     NULL,      NULL, N'MEDICAL INSURANCE',   NULL,  -87.50),
    (@sid, 'DEDUCTION',     NULL,      NULL, N'ESCROW',              NULL,  -50.00);
-- Settlement total: 1274.10 + 50.00 + 383.75 - 137.50 = 1570.35

------------------------------------------------------------------------------
-- JAMES SMITH -- week ending 08/08, paid 08/14
-- Includes a SPECIAL line with no miles, which is what makes the settlement
-- show a flat amount in the rate column instead of dividing by zero.
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('JSMITH', '2026-08-14', '2026-08-02', '2026-08-08', 'CK-260814-0001');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, load_id, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-10395', 'L-30009', 'D-43870', 'Demo - 15', N'DUBUQUE, IA - MINNEAPOLIS, MN',     246, 20, 266, 0.6200, 164.92),
    (@sid, 'O-10397', 'L-30010', 'D-43885', 'Demo - 15', N'MINNEAPOLIS, MN - MILWAUKEE, WI',   337, 35, 372, 0.6200, 230.64),
    (@sid, 'O-10399', 'L-30011', 'D-43901', 'Demo - 15', N'MILWAUKEE, WI - INDIANAPOLIS, IN',  279, 18, 297, 0.6200, 184.14),
    (@sid, 'SPECIAL', NULL,  NULL,     'Demo - 15', N'BREAKDOWN / LAYOVER PAY',             0,  0,   0, 0.0000, 150.00);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE',       NULL, 'PYMIN', N'MINIMUM PAY',        NULL,     200.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL,    N'PER DIEM - 3 DAYS',  NULL,     213.00),
    (@sid, 'DEDUCTION',     NULL, NULL,    N'MEDICAL INSURANCE',  NULL,     -87.50),
    (@sid, 'DEDUCTION',     NULL, NULL,    N'ADVANCE',            N'CD-88104', -100.00);
-- Settlement total: 729.70 + 200.00 + 213.00 - 187.50 = 955.20

------------------------------------------------------------------------------
-- SHERMAN OAKS -- paid 08/28
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('SOAKS', '2026-08-28', '2026-08-16', '2026-08-22', 'CK-260828-0010');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, load_id, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-10413', 'L-30012', 'D-44125', 'Demo - 10', N'CEDAR RAPIDS, IA - KANSAS CITY, MO',    322, 28, 350, 0.5800, 203.00),
    (@sid, 'O-10416', 'L-30013', 'D-44142', 'Demo - 10', N'KANSAS CITY, MO - OKLAHOMA CITY, OK',   353, 15, 368, 0.5800, 213.44),
    (@sid, 'O-10419', 'L-30014', 'D-44159', 'Demo - 10', N'OKLAHOMA CITY, OK - CEDAR RAPIDS, IA',  698, 32, 730, 0.5800, 423.40);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE',       NULL,      NULL, N'Wkly Sfty Incentive', NULL,  50.00),
    (@sid, 'REIMBURSEMENT', NULL,      NULL, N'PER DIEM - 3 DAYS',   NULL, 213.00),
    (@sid, 'REIMBURSEMENT', 'O-10416', NULL, N'MOTEL',               NULL,  89.95),
    (@sid, 'DEDUCTION',     NULL,      NULL, N'MEDICAL INSURANCE',   NULL, -76.00),
    (@sid, 'DEDUCTION',     NULL,      NULL, N'ESCROW',              NULL, -50.00);
-- Settlement total: 839.84 + 50.00 + 302.95 - 126.00 = 1066.79

------------------------------------------------------------------------------
-- SHERMAN OAKS -- paid 08/21
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('SOAKS', '2026-08-21', '2026-08-09', '2026-08-15', 'CK-260821-0010');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, load_id, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-10404', 'L-30015', 'D-43990', 'Demo - 10', N'CEDAR RAPIDS, IA - ST. LOUIS, MO',  340, 22, 362, 0.5800, 209.96),
    (@sid, 'O-10407', 'L-30016', 'D-44005', 'Demo - 10', N'ST. LOUIS, MO - NASHVILLE, TN',     309, 18, 327, 0.5800, 189.66),
    (@sid, 'O-10409', 'L-30017', 'D-44021', 'Demo - 10', N'NASHVILLE, TN - CEDAR RAPIDS, IA',  621, 30, 651, 0.5800, 377.58);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REIMBURSEMENT', NULL,      NULL, N'PER DIEM - 3 DAYS', NULL,     213.00),
    (@sid, 'REIMBURSEMENT', 'O-10407', NULL, N'TOLLS',             NULL,      18.40),
    (@sid, 'DEDUCTION',     NULL,      NULL, N'MEDICAL INSURANCE', NULL,     -76.00),
    (@sid, 'DEDUCTION',     NULL,      NULL, N'ADVANCE',           N'CD-90551', -125.00);
-- Settlement total: 777.20 + 231.40 - 201.00 = 807.60

GO

------------------------------------------------------------------------------
-- Check what landed. The total here is computed the same way the API computes
-- it, so these figures are what the statement should show. No tax is withheld
-- anywhere: this is earnings less deductions, not take-home pay.
------------------------------------------------------------------------------
SELECT s.driver_code,
       CONVERT(char(10), s.check_date, 120) AS check_date,
       s.document_no,
       r.miles,
       r.route_pay,
       COALESCE(l.line_total, 0)              AS lines_total,
       r.route_pay + COALESCE(l.line_total, 0) AS settlement_total
FROM dbo.Settlements AS s
CROSS APPLY (
    SELECT COALESCE(SUM(total_miles), 0) AS miles,
           COALESCE(SUM(pay_amount), 0)  AS route_pay
    FROM dbo.SettlementRoutes WHERE settlement_id = s.settlement_id
) AS r
OUTER APPLY (
    SELECT SUM(amount) AS line_total
    FROM dbo.SettlementLines WHERE settlement_id = s.settlement_id
) AS l
ORDER BY s.driver_code, s.check_date DESC;
