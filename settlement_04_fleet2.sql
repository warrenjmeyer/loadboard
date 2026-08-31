-- settlement_04_fleet2.sql
-- The eight drivers that bring the fleet to twenty, plus two
-- weeks of settlements each.
--
-- Names, and the driver codes derived from them, match the Advanced User
-- List export from demo_millstream. Every dollar figure is invented.
--
-- Generated rather than hand-written: pay_amount is total_miles * pay_rate to
-- the cent on every line, and the settlement total in each comment is the sum
-- of what precedes it. Hand-keying settlements at this volume is how a seed
-- file ends up with totals that quietly disagree with their own detail.
--
-- Re-runnable. Requires settlement_01_ddl.sql.

SET NOCOUNT ON;

DELETE FROM dbo.Settlements WHERE driver_code IN ('OVAUGHN', 'PRAMAN', 'GWHITFIELD', 'ACORTEZ', 'DFRYE', 'ISOLBERG', 'TBOONE', 'NPRUITT');
GO

------------------------------------------------------------------------------
-- Drivers
------------------------------------------------------------------------------
MERGE dbo.Drivers AS target
USING (VALUES
    ('OVAUGHN', N'Otis', N'Vaughn', N'2633 Jackson Street', NULL, N'Dubuque', N'IA', '52001', '7515',
     N'OTR Driver', 0.6000, 'W', N'HMLOTR', N'Dubuque, IA', N'Linehaul', N'Company Driver'),
    ('PRAMAN', N'Priya', N'Raman', N'2633 Jackson Street', NULL, N'Dubuque', N'IA', '52001', '9475',
     N'OTR Driver', 0.6400, 'W', N'HMLOTR', N'Dubuque, IA', N'Linehaul', N'Company Driver'),
    ('GWHITFIELD', N'Gus', N'Whitfield', N'2633 Jackson Street', NULL, N'Dubuque', N'IA', '52001', '5505',
     N'OTR Driver', 0.5800, 'W', N'HMLOTR', N'Dubuque, IA', N'Linehaul', N'Company Driver'),
    ('ACORTEZ', N'Alma', N'Cortez', N'2633 Jackson Street', NULL, N'Dubuque', N'IA', '52001', '1214',
     N'OTR Driver', 0.6500, 'W', N'HMLOTR', N'Dubuque, IA', N'Linehaul', N'Company Driver'),
    ('DFRYE', N'Desmond', N'Frye', N'2633 Jackson Street', NULL, N'Dubuque', N'IA', '52001', '2230',
     N'OTR Driver', 0.6200, 'W', N'HMLOTR', N'Dubuque, IA', N'Linehaul', N'Company Driver'),
    ('ISOLBERG', N'Ingrid', N'Solberg', N'2633 Jackson Street', NULL, N'Dubuque', N'IA', '52001', '7643',
     N'OTR Driver', 0.6300, 'W', N'HMLOTR', N'Dubuque, IA', N'Linehaul', N'Company Driver'),
    ('TBOONE', N'Terrell', N'Boone', N'2633 Jackson Street', NULL, N'Dubuque', N'IA', '52001', '3206',
     N'OTR Driver', 0.5900, 'W', N'HMLOTR', N'Dubuque, IA', N'Linehaul', N'Company Driver'),
    ('NPRUITT', N'Nadia', N'Pruitt', N'2633 Jackson Street', NULL, N'Dubuque', N'IA', '52001', '4493',
     N'OTR Driver', 0.6600, 'W', N'HMLOTR', N'Dubuque, IA', N'Linehaul', N'Company Driver')
) AS source (driver_code, first_name, last_name, address1, address2, city, state, postal_code,
             ssn_last4, job, pay_rate, pay_frequency, pay_group, location, department, job_type)
ON target.driver_code = source.driver_code
WHEN MATCHED THEN UPDATE SET
    first_name = source.first_name, last_name = source.last_name, pay_rate = source.pay_rate,
    job = source.job, pay_group = source.pay_group, location = source.location,
    department = source.department, job_type = source.job_type
WHEN NOT MATCHED THEN INSERT (driver_code, first_name, last_name, address1, address2, city, state,
    postal_code, ssn_last4, job, pay_rate, pay_frequency, pay_group, location, department, job_type)
VALUES (source.driver_code, source.first_name, source.last_name, source.address1, source.address2,
    source.city, source.state, source.postal_code, source.ssn_last4, source.job, source.pay_rate,
    source.pay_frequency, source.pay_group, source.location, source.department, source.job_type);
GO

DECLARE @sid INT;

------------------------------------------------------------------------------
-- OTIS VAUGHN -- paid 08/21
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('OVAUGHN', '2026-08-21', '2026-08-09', '2026-08-15', 'CK-260821-0301');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-21000', 'D-51000', '2400', N'DUBUQUE, IA - KANSAS CITY, MO', 322, 27, 349, 0.6000, 209.40),
    (@sid, 'O-21001', 'D-51001', '2400', N'SIOUX CITY, IA - OMAHA, NE', 95, 27, 122, 0.6000, 73.20),
    (@sid, 'O-21002', 'D-51002', '2400', N'DENVER, CO - OMAHA, NE', 537, 29, 566, 0.6000, 339.60);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Sfty Incentive', NULL, 50.00),
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Incentive Bonus', NULL, 100.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 4 DAYS', NULL, 284.00),
    (@sid, 'REIMBURSEMENT', 'O-21000', NULL, N'TOLLS', NULL, 51.06),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -92.76),
    (@sid, 'DEDUCTION', NULL, NULL, N'ADVANCE', N'CD-91450', -150.00);
-- Settlement total: 622.20 + 242.30 = 864.50

------------------------------------------------------------------------------
-- OTIS VAUGHN -- paid 08/28
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('OVAUGHN', '2026-08-28', '2026-08-16', '2026-08-22', 'CK-260828-0302');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-21003', 'D-51003', '2400', N'DENVER, CO - OMAHA, NE', 537, 18, 555, 0.6000, 333.00),
    (@sid, 'O-21004', 'D-51004', '2400', N'IOWA CITY, IA - MILWAUKEE, WI', 232, 24, 256, 0.6000, 153.60),
    (@sid, 'O-21005', 'D-51005', '2400', N'DUBUQUE, IA - ST. LOUIS, MO', 340, 25, 365, 0.6000, 219.00),
    (@sid, 'O-21006', 'D-51006', '2400', N'DALLAS, TX - MEMPHIS, TN', 452, 12, 464, 0.6000, 278.40);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Sfty Incentive', NULL, 50.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 3 DAYS', NULL, 213.00),
    (@sid, 'REIMBURSEMENT', 'O-21003', NULL, N'TOLLS', NULL, 24.71),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -88.51),
    (@sid, 'DEDUCTION', NULL, NULL, N'ESCROW', NULL, -50.00);
-- Settlement total: 984.00 + 149.20 = 1133.20

------------------------------------------------------------------------------
-- PRIYA RAMAN -- paid 08/21
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('PRAMAN', '2026-08-21', '2026-08-09', '2026-08-15', 'CK-260821-0303');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-21007', 'D-51007', '2401', N'DES MOINES, IA - DENVER, CO', 670, 23, 693, 0.6400, 443.52),
    (@sid, 'O-21008', 'D-51008', '2401', N'DUBUQUE, IA - ST. LOUIS, MO', 340, 25, 365, 0.6400, 233.60),
    (@sid, 'O-21009', 'D-51009', '2401', N'SIOUX CITY, IA - OMAHA, NE', 95, 29, 124, 0.6400, 79.36);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Sfty Incentive', NULL, 50.00),
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Incentive Bonus', NULL, 78.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 3 DAYS', NULL, 213.00),
    (@sid, 'REIMBURSEMENT', 'O-21007', NULL, N'TOLLS', NULL, 37.83),
    (@sid, 'REIMBURSEMENT', 'O-21008', NULL, N'MOTEL', NULL, 94.69),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -70.71);
-- Settlement total: 756.48 + 402.81 = 1159.29

------------------------------------------------------------------------------
-- PRIYA RAMAN -- paid 08/28
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('PRAMAN', '2026-08-28', '2026-08-16', '2026-08-22', 'CK-260828-0304');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-21010', 'D-51010', '2401', N'DALLAS, TX - MEMPHIS, TN', 452, 25, 477, 0.6400, 305.28),
    (@sid, 'O-21011', 'D-51011', '2401', N'DENVER, CO - OMAHA, NE', 537, 29, 566, 0.6400, 362.24),
    (@sid, 'O-21012', 'D-51012', '2401', N'SIOUX CITY, IA - OMAHA, NE', 95, 24, 119, 0.6400, 76.16);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Sfty Incentive', NULL, 50.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 2 DAYS', NULL, 142.00),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -79.51),
    (@sid, 'DEDUCTION', NULL, NULL, N'ESCROW', NULL, -50.00);
-- Settlement total: 743.68 + 62.49 = 806.17

------------------------------------------------------------------------------
-- GUS WHITFIELD -- paid 08/21
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('GWHITFIELD', '2026-08-21', '2026-08-09', '2026-08-15', 'CK-260821-0305');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-21013', 'D-51013', '2402', N'IOWA CITY, IA - MILWAUKEE, WI', 232, 11, 243, 0.5800, 140.94),
    (@sid, 'O-21014', 'D-51014', '2402', N'NASHVILLE, TN - CEDAR RAPIDS, IA', 621, 40, 661, 0.5800, 383.38),
    (@sid, 'O-21015', 'D-51015', '2402', N'SIOUX CITY, IA - OMAHA, NE', 95, 35, 130, 0.5800, 75.40);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 3 DAYS', NULL, 213.00),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -77.57);
-- Settlement total: 599.72 + 135.43 = 735.15

------------------------------------------------------------------------------
-- GUS WHITFIELD -- paid 08/28
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('GWHITFIELD', '2026-08-28', '2026-08-16', '2026-08-22', 'CK-260828-0306');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-21016', 'D-51016', '2402', N'DUBUQUE, IA - KANSAS CITY, MO', 322, 37, 359, 0.5800, 208.22),
    (@sid, 'O-21017', 'D-51017', '2402', N'ST. LOUIS, MO - NASHVILLE, TN', 309, 41, 350, 0.5800, 203.00),
    (@sid, 'O-21018', 'D-51018', '2402', N'MEMPHIS, TN - DUBUQUE, IA', 612, 22, 634, 0.5800, 367.72);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Sfty Incentive', NULL, 50.00),
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Incentive Bonus', NULL, 130.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 3 DAYS', NULL, 213.00),
    (@sid, 'REIMBURSEMENT', 'O-21016', NULL, N'TOLLS', NULL, 42.74),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -85.04),
    (@sid, 'DEDUCTION', NULL, NULL, N'ADVANCE', N'CD-98925', -196.00),
    (@sid, 'DEDUCTION', NULL, NULL, N'ESCROW', NULL, -50.00);
-- Settlement total: 778.94 + 104.70 = 883.64

------------------------------------------------------------------------------
-- ALMA CORTEZ -- paid 08/21
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('ACORTEZ', '2026-08-21', '2026-08-09', '2026-08-15', 'CK-260821-0307');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-21019', 'D-51019', '2403', N'IOWA CITY, IA - MILWAUKEE, WI', 232, 29, 261, 0.6500, 169.65),
    (@sid, 'O-21020', 'D-51020', '2403', N'DUBUQUE, IA - KANSAS CITY, MO', 322, 36, 358, 0.6500, 232.70),
    (@sid, 'O-21021', 'D-51021', '2403', N'DENVER, CO - OMAHA, NE', 537, 33, 570, 0.6500, 370.50);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Sfty Incentive', NULL, 50.00),
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Incentive Bonus', NULL, 137.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 4 DAYS', NULL, 284.00),
    (@sid, 'REIMBURSEMENT', 'O-21019', NULL, N'TOLLS', NULL, 28.14),
    (@sid, 'REIMBURSEMENT', 'O-21020', NULL, N'MOTEL', NULL, 83.67),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -93.17);
-- Settlement total: 772.85 + 489.64 = 1262.49

------------------------------------------------------------------------------
-- ALMA CORTEZ -- paid 08/28
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('ACORTEZ', '2026-08-28', '2026-08-16', '2026-08-22', 'CK-260828-0308');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-21022', 'D-51022', '2403', N'NASHVILLE, TN - CEDAR RAPIDS, IA', 621, 32, 653, 0.6500, 424.45),
    (@sid, 'O-21023', 'D-51023', '2403', N'CEDAR RAPIDS, IA - ST. LOUIS, MO', 340, 39, 379, 0.6500, 246.35),
    (@sid, 'O-21024', 'D-51024', '2403', N'DUBUQUE, IA - KANSAS CITY, MO', 322, 33, 355, 0.6500, 230.75);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Sfty Incentive', NULL, 50.00),
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Incentive Bonus', NULL, 123.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 5 DAYS', NULL, 355.00),
    (@sid, 'REIMBURSEMENT', 'O-21022', NULL, N'TOLLS', NULL, 52.38),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -72.89),
    (@sid, 'DEDUCTION', NULL, NULL, N'ESCROW', NULL, -50.00);
-- Settlement total: 901.55 + 457.49 = 1359.04

------------------------------------------------------------------------------
-- DESMOND FRYE -- paid 08/21
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('DFRYE', '2026-08-21', '2026-08-09', '2026-08-15', 'CK-260821-0309');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-21025', 'D-51025', '2404', N'DUBUQUE, IA - CHICAGO, IL', 182, 40, 222, 0.6200, 137.64),
    (@sid, 'O-21026', 'D-51026', '2404', N'DUBUQUE, IA - KANSAS CITY, MO', 322, 14, 336, 0.6200, 208.32),
    (@sid, 'O-21027', 'D-51027', '2404', N'IOWA CITY, IA - MILWAUKEE, WI', 232, 37, 269, 0.6200, 166.78);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Sfty Incentive', NULL, 50.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 5 DAYS', NULL, 355.00),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -92.40),
    (@sid, 'DEDUCTION', NULL, NULL, N'ADVANCE', N'CD-93019', -180.00),
    (@sid, 'DEDUCTION', NULL, NULL, N'ESCROW', NULL, -50.00);
-- Settlement total: 512.74 + 82.60 = 595.34

------------------------------------------------------------------------------
-- DESMOND FRYE -- paid 08/28
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('DFRYE', '2026-08-28', '2026-08-16', '2026-08-22', 'CK-260828-0310');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-21028', 'D-51028', '2404', N'OMAHA, NE - DUBUQUE, IA', 372, 42, 414, 0.6200, 256.68),
    (@sid, 'O-21029', 'D-51029', '2404', N'CEDAR RAPIDS, IA - ST. LOUIS, MO', 340, 19, 359, 0.6200, 222.58),
    (@sid, 'O-21030', 'D-51030', '2404', N'CHICAGO, IL - DENVER, CO', 1003, 17, 1020, 0.6200, 632.40),
    (@sid, 'O-21031', 'D-51031', '2404', N'IOWA CITY, IA - MILWAUKEE, WI', 232, 23, 255, 0.6200, 158.10);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Sfty Incentive', NULL, 50.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 2 DAYS', NULL, 142.00),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -91.96),
    (@sid, 'DEDUCTION', NULL, NULL, N'ADVANCE', N'CD-95516', -196.00);
-- Settlement total: 1269.76 + -95.96 = 1173.80

------------------------------------------------------------------------------
-- INGRID SOLBERG -- paid 08/21
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('ISOLBERG', '2026-08-21', '2026-08-09', '2026-08-15', 'CK-260821-0311');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-21032', 'D-51032', '2405', N'DUBUQUE, IA - ST. LOUIS, MO', 340, 26, 366, 0.6300, 230.58),
    (@sid, 'O-21033', 'D-51033', '2405', N'DES MOINES, IA - DENVER, CO', 670, 28, 698, 0.6300, 439.74),
    (@sid, 'O-21034', 'D-51034', '2405', N'CHICAGO, IL - DENVER, CO', 1003, 16, 1019, 0.6300, 641.97),
    (@sid, 'O-21035', 'D-51035', '2405', N'DALLAS, TX - MEMPHIS, TN', 452, 13, 465, 0.6300, 292.95);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Sfty Incentive', NULL, 50.00),
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Incentive Bonus', NULL, 115.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 3 DAYS', NULL, 213.00),
    (@sid, 'REIMBURSEMENT', 'O-21033', NULL, N'MOTEL', NULL, 78.36),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -73.13);
-- Settlement total: 1605.24 + 383.23 = 1988.47

------------------------------------------------------------------------------
-- INGRID SOLBERG -- paid 08/28
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('ISOLBERG', '2026-08-28', '2026-08-16', '2026-08-22', 'CK-260828-0312');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-21036', 'D-51036', '2405', N'CEDAR RAPIDS, IA - ST. LOUIS, MO', 340, 38, 378, 0.6300, 238.14),
    (@sid, 'O-21037', 'D-51037', '2405', N'DUBUQUE, IA - CHICAGO, IL', 182, 26, 208, 0.6300, 131.04),
    (@sid, 'O-21038', 'D-51038', '2405', N'MEMPHIS, TN - DUBUQUE, IA', 612, 36, 648, 0.6300, 408.24),
    (@sid, 'O-21039', 'D-51039', '2405', N'KANSAS CITY, MO - DALLAS, TX', 552, 19, 571, 0.6300, 359.73);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Sfty Incentive', NULL, 50.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 2 DAYS', NULL, 142.00),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -92.53),
    (@sid, 'DEDUCTION', NULL, NULL, N'ADVANCE', N'CD-89525', -103.00);
-- Settlement total: 1137.15 + -3.53 = 1133.62

------------------------------------------------------------------------------
-- TERRELL BOONE -- paid 08/21
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('TBOONE', '2026-08-21', '2026-08-09', '2026-08-15', 'CK-260821-0313');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-21040', 'D-51040', '2406', N'DUBUQUE, IA - ST. LOUIS, MO', 340, 14, 354, 0.5900, 208.86),
    (@sid, 'O-21041', 'D-51041', '2406', N'CEDAR RAPIDS, IA - ST. LOUIS, MO', 340, 33, 373, 0.5900, 220.07),
    (@sid, 'O-21042', 'D-51042', '2406', N'WATERLOO, IA - MINNEAPOLIS, MN', 246, 10, 256, 0.5900, 151.04),
    (@sid, 'O-21043', 'D-51043', '2406', N'DUBUQUE, IA - CHICAGO, IL', 182, 11, 193, 0.5900, 113.87);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Sfty Incentive', NULL, 50.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 5 DAYS', NULL, 355.00),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -72.60);
-- Settlement total: 693.84 + 332.40 = 1026.24

------------------------------------------------------------------------------
-- TERRELL BOONE -- paid 08/28
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('TBOONE', '2026-08-28', '2026-08-16', '2026-08-22', 'CK-260828-0314');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-21044', 'D-51044', '2406', N'MILWAUKEE, WI - INDIANAPOLIS, IN', 279, 37, 316, 0.5900, 186.44),
    (@sid, 'O-21045', 'D-51045', '2406', N'DUBUQUE, IA - ST. LOUIS, MO', 340, 43, 383, 0.5900, 225.97),
    (@sid, 'O-21046', 'D-51046', '2406', N'IOWA CITY, IA - MILWAUKEE, WI', 232, 39, 271, 0.5900, 159.89);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 4 DAYS', NULL, 284.00),
    (@sid, 'REIMBURSEMENT', 'O-21044', NULL, N'TOLLS', NULL, 33.17),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -77.12),
    (@sid, 'DEDUCTION', NULL, NULL, N'ADVANCE', N'CD-91652', -142.00);
-- Settlement total: 572.30 + 98.05 = 670.35

------------------------------------------------------------------------------
-- NADIA PRUITT -- paid 08/21
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('NPRUITT', '2026-08-21', '2026-08-09', '2026-08-15', 'CK-260821-0315');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-21047', 'D-51047', '2407', N'CHICAGO, IL - DENVER, CO', 1003, 41, 1044, 0.6600, 689.04),
    (@sid, 'O-21048', 'D-51048', '2407', N'DENVER, CO - OMAHA, NE', 537, 23, 560, 0.6600, 369.60),
    (@sid, 'O-21049', 'D-51049', '2407', N'CEDAR RAPIDS, IA - ST. LOUIS, MO', 340, 27, 367, 0.6600, 242.22),
    (@sid, 'O-21050', 'D-51050', '2407', N'KANSAS CITY, MO - DALLAS, TX', 552, 43, 595, 0.6600, 392.70);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Incentive Bonus', NULL, 125.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 3 DAYS', NULL, 213.00),
    (@sid, 'REIMBURSEMENT', 'O-21047', NULL, N'TOLLS', NULL, 54.14),
    (@sid, 'REIMBURSEMENT', 'O-21048', NULL, N'MOTEL', NULL, 67.41),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -90.91);
-- Settlement total: 1693.56 + 368.64 = 2062.20

------------------------------------------------------------------------------
-- NADIA PRUITT -- paid 08/28
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('NPRUITT', '2026-08-28', '2026-08-16', '2026-08-22', 'CK-260828-0316');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-21051', 'D-51051', '2407', N'DENVER, CO - OMAHA, NE', 537, 23, 560, 0.6600, 369.60),
    (@sid, 'O-21052', 'D-51052', '2407', N'OMAHA, NE - DUBUQUE, IA', 372, 40, 412, 0.6600, 271.92),
    (@sid, 'O-21053', 'D-51053', '2407', N'ST. LOUIS, MO - NASHVILLE, TN', 309, 17, 326, 0.6600, 215.16),
    (@sid, 'O-21054', 'D-51054', '2407', N'DUBUQUE, IA - ST. LOUIS, MO', 340, 41, 381, 0.6600, 251.46);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Incentive Bonus', NULL, 129.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 4 DAYS', NULL, 284.00),
    (@sid, 'REIMBURSEMENT', 'O-21051', NULL, N'TOLLS', NULL, 28.63),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -85.37);
-- Settlement total: 1108.14 + 356.26 = 1464.40
GO

------------------------------------------------------------------------------
-- What landed. These totals are what the statements should show.
------------------------------------------------------------------------------
SELECT s.driver_code,
       CONVERT(char(10), s.check_date, 120) AS check_date,
       r.miles,
       r.route_pay + COALESCE(l.line_total, 0) AS settlement_total
FROM dbo.Settlements AS s
CROSS APPLY (SELECT COALESCE(SUM(total_miles),0) AS miles, COALESCE(SUM(pay_amount),0) AS route_pay
             FROM dbo.SettlementRoutes WHERE settlement_id = s.settlement_id) AS r
OUTER APPLY (SELECT SUM(amount) AS line_total
             FROM dbo.SettlementLines WHERE settlement_id = s.settlement_id) AS l
WHERE s.driver_code IN ('OVAUGHN', 'PRAMAN', 'GWHITFIELD', 'ACORTEZ', 'DFRYE', 'ISOLBERG', 'TBOONE', 'NPRUITT')
ORDER BY s.driver_code, s.check_date DESC;
