-- settlement_03_fleet.sql
-- The ten drivers created in MyGeotab by geotab-add-drivers.ps1, plus two
-- weeks of settlements each.
--
-- Names, and the driver codes derived from them, match the Advanced User
-- List export from demo_millstream. Every dollar figure is invented.
--
-- Generated rather than hand-written: pay_amount is total_miles * pay_rate to
-- the cent on every line, and the settlement total in each comment is the sum
-- of what precedes it. Hand-keying twenty settlements is how a seed file ends
-- up with totals that quietly disagree with their own detail.
--
-- Re-runnable. Requires settlement_01_ddl.sql.

SET NOCOUNT ON;

DELETE FROM dbo.Settlements WHERE driver_code IN ('HBARNETT', 'RDELGADO', 'DFOSTER', 'LHARTMAN', 'EKLEIN', 'CNOLAN', 'JPACE', 'TRUIZ', 'MWEBB', 'WYATES');
GO

------------------------------------------------------------------------------
-- Drivers
------------------------------------------------------------------------------
MERGE dbo.Drivers AS target
USING (VALUES
    ('HBARNETT', N'Hollis', N'Barnett', N'2633 Jackson Street', NULL, N'Dubuque', N'IA', '52001', '7895',
     N'OTR Driver', 0.6100, 'W', N'HMLOTR', N'Dubuque, IA', N'Linehaul', N'Company Driver'),
    ('RDELGADO', N'Rosa', N'Delgado', N'2633 Jackson Street', NULL, N'Dubuque', N'IA', '52001', '1387',
     N'OTR Driver', 0.6400, 'W', N'HMLOTR', N'Dubuque, IA', N'Linehaul', N'Company Driver'),
    ('DFOSTER', N'Dale', N'Foster', N'2633 Jackson Street', NULL, N'Dubuque', N'IA', '52001', '9499',
     N'OTR Driver', 0.6000, 'W', N'HMLOTR', N'Dubuque, IA', N'Linehaul', N'Company Driver'),
    ('LHARTMAN', N'Lena', N'Hartman', N'2633 Jackson Street', NULL, N'Dubuque', N'IA', '52001', '5195',
     N'OTR Driver', 0.6300, 'W', N'HMLOTR', N'Dubuque, IA', N'Linehaul', N'Company Driver'),
    ('EKLEIN', N'Everett', N'Klein', N'2633 Jackson Street', NULL, N'Dubuque', N'IA', '52001', '6069',
     N'OTR Driver', 0.5900, 'W', N'HMLOTR', N'Dubuque, IA', N'Linehaul', N'Company Driver'),
    ('CNOLAN', N'Cyrus', N'Nolan', N'2633 Jackson Street', NULL, N'Dubuque', N'IA', '52001', '8118',
     N'OTR Driver', 0.6200, 'W', N'HMLOTR', N'Dubuque, IA', N'Linehaul', N'Company Driver'),
    ('JPACE', N'Junior', N'Pace', N'2633 Jackson Street', NULL, N'Dubuque', N'IA', '52001', '4939',
     N'OTR Driver', 0.5700, 'W', N'HMLOTR', N'Dubuque, IA', N'Linehaul', N'Company Driver'),
    ('TRUIZ', N'Tanya', N'Ruiz', N'2633 Jackson Street', NULL, N'Dubuque', N'IA', '52001', '6524',
     N'OTR Driver', 0.6500, 'W', N'HMLOTR', N'Dubuque, IA', N'Linehaul', N'Company Driver'),
    ('MWEBB', N'Marcus', N'Webb', N'2633 Jackson Street', NULL, N'Dubuque', N'IA', '52001', '8625',
     N'OTR Driver', 0.6000, 'W', N'HMLOTR', N'Dubuque, IA', N'Linehaul', N'Company Driver'),
    ('WYATES', N'Wanda', N'Yates', N'2633 Jackson Street', NULL, N'Dubuque', N'IA', '52001', '1164',
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
-- HOLLIS BARNETT -- paid 08/21
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('HBARNETT', '2026-08-21', '2026-08-09', '2026-08-15', 'CK-260821-0001');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, load_id, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-20500', 'L-30018', 'D-50000', 'Demo - 01', N'ST. LOUIS, MO - NASHVILLE, TN', 309, 27, 336, 0.6100, 204.96),
    (@sid, 'O-20501', 'L-30019', 'D-50001', 'Demo - 01', N'KANSAS CITY, MO - DALLAS, TX', 552, 23, 575, 0.6100, 350.75),
    (@sid, 'O-20502', 'L-30020', 'D-50002', 'Demo - 01', N'OMAHA, NE - DUBUQUE, IA', 372, 24, 396, 0.6100, 241.56),
    (@sid, 'O-20503', 'L-30021', 'D-50003', 'Demo - 01', N'NASHVILLE, TN - CEDAR RAPIDS, IA', 621, 44, 665, 0.6100, 405.65);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Sfty Incentive', NULL, 50.00),
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Incentive Bonus', NULL, 147.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 5 DAYS', NULL, 355.00),
    (@sid, 'REIMBURSEMENT', 'O-20500', NULL, N'TOLLS', NULL, 45.83),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -77.27);
-- Settlement total: 1202.92 + 520.56 = 1723.48

------------------------------------------------------------------------------
-- HOLLIS BARNETT -- paid 08/28
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('HBARNETT', '2026-08-28', '2026-08-16', '2026-08-22', 'CK-260828-0001');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, load_id, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-20504', 'L-30022', 'D-50004', 'Demo - 01', N'MILWAUKEE, WI - INDIANAPOLIS, IN', 279, 27, 306, 0.6100, 186.66),
    (@sid, 'O-20505', 'L-30023', 'D-50005', 'Demo - 01', N'DUBUQUE, IA - KANSAS CITY, MO', 322, 37, 359, 0.6100, 218.99),
    (@sid, 'O-20506', 'L-30024', 'D-50006', 'Demo - 01', N'DUBUQUE, IA - ST. LOUIS, MO', 340, 30, 370, 0.6100, 225.70);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Sfty Incentive', NULL, 50.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 3 DAYS', NULL, 213.00),
    (@sid, 'REIMBURSEMENT', 'O-20504', NULL, N'TOLLS', NULL, 22.77),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -83.92),
    (@sid, 'DEDUCTION', NULL, NULL, N'ADVANCE', N'CD-93798', -167.00);
-- Settlement total: 631.35 + 34.85 = 666.20

------------------------------------------------------------------------------
-- ROSA DELGADO -- paid 08/21
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('RDELGADO', '2026-08-21', '2026-08-09', '2026-08-15', 'CK-260821-0004');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, load_id, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-20507', 'L-30025', 'D-50007', 'Demo - 04', N'KANSAS CITY, MO - DALLAS, TX', 552, 17, 569, 0.6400, 364.16),
    (@sid, 'O-20508', 'L-30026', 'D-50008', 'Demo - 04', N'MINNEAPOLIS, MN - MILWAUKEE, WI', 337, 28, 365, 0.6400, 233.60),
    (@sid, 'O-20509', 'L-30027', 'D-50009', 'Demo - 04', N'SIOUX CITY, IA - OMAHA, NE', 95, 14, 109, 0.6400, 69.76),
    (@sid, 'O-20510', 'L-30028', 'D-50010', 'Demo - 04', N'DALLAS, TX - MEMPHIS, TN', 452, 21, 473, 0.6400, 302.72);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Sfty Incentive', NULL, 50.00),
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Incentive Bonus', NULL, 116.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 5 DAYS', NULL, 355.00),
    (@sid, 'REIMBURSEMENT', 'O-20507', NULL, N'TOLLS', NULL, 33.32),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -77.97),
    (@sid, 'DEDUCTION', NULL, NULL, N'ADVANCE', N'CD-92531', -184.00);
-- Settlement total: 970.24 + 292.35 = 1262.59

------------------------------------------------------------------------------
-- ROSA DELGADO -- paid 08/28
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('RDELGADO', '2026-08-28', '2026-08-16', '2026-08-22', 'CK-260828-0004');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, load_id, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-20511', 'L-30029', 'D-50011', 'Demo - 04', N'SIOUX CITY, IA - OMAHA, NE', 95, 42, 137, 0.6400, 87.68),
    (@sid, 'O-20512', 'L-30030', 'D-50012', 'Demo - 04', N'WATERLOO, IA - MINNEAPOLIS, MN', 246, 11, 257, 0.6400, 164.48),
    (@sid, 'O-20513', 'L-30031', 'D-50013', 'Demo - 04', N'DENVER, CO - OMAHA, NE', 537, 40, 577, 0.6400, 369.28);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Incentive Bonus', NULL, 88.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 4 DAYS', NULL, 284.00),
    (@sid, 'REIMBURSEMENT', 'O-20511', NULL, N'TOLLS', NULL, 33.15),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -70.13),
    (@sid, 'DEDUCTION', NULL, NULL, N'ESCROW', NULL, -50.00);
-- Settlement total: 621.44 + 285.02 = 906.46

------------------------------------------------------------------------------
-- DALE FOSTER -- paid 08/21
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('DFOSTER', '2026-08-21', '2026-08-09', '2026-08-15', 'CK-260821-0005');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, load_id, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-20514', 'L-30032', 'D-50014', 'Demo - 05', N'DUBUQUE, IA - CHICAGO, IL', 182, 22, 204, 0.6000, 122.40),
    (@sid, 'O-20515', 'L-30033', 'D-50015', 'Demo - 05', N'DUBUQUE, IA - ST. LOUIS, MO', 340, 23, 363, 0.6000, 217.80),
    (@sid, 'O-20516', 'L-30034', 'D-50016', 'Demo - 05', N'DUBUQUE, IA - KANSAS CITY, MO', 322, 25, 347, 0.6000, 208.20);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Sfty Incentive', NULL, 50.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 3 DAYS', NULL, 213.00),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -77.55),
    (@sid, 'DEDUCTION', NULL, NULL, N'ADVANCE', N'CD-88145', -98.00);
-- Settlement total: 548.40 + 87.45 = 635.85

------------------------------------------------------------------------------
-- DALE FOSTER -- paid 08/28
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('DFOSTER', '2026-08-28', '2026-08-16', '2026-08-22', 'CK-260828-0005');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, load_id, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-20517', 'L-30035', 'D-50017', 'Demo - 05', N'OMAHA, NE - DUBUQUE, IA', 372, 11, 383, 0.6000, 229.80),
    (@sid, 'O-20518', 'L-30036', 'D-50018', 'Demo - 05', N'DUBUQUE, IA - KANSAS CITY, MO', 322, 40, 362, 0.6000, 217.20),
    (@sid, 'O-20519', 'L-30037', 'D-50019', 'Demo - 05', N'DENVER, CO - OMAHA, NE', 537, 30, 567, 0.6000, 340.20),
    (@sid, 'O-20520', 'L-30038', 'D-50020', 'Demo - 05', N'DUBUQUE, IA - CHICAGO, IL', 182, 43, 225, 0.6000, 135.00);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Sfty Incentive', NULL, 50.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 3 DAYS', NULL, 213.00),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -75.39),
    (@sid, 'DEDUCTION', NULL, NULL, N'ESCROW', NULL, -50.00);
-- Settlement total: 922.20 + 137.61 = 1059.81

------------------------------------------------------------------------------
-- LENA HARTMAN -- paid 08/21
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('LHARTMAN', '2026-08-21', '2026-08-09', '2026-08-15', 'CK-260821-0007');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, load_id, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-20521', 'L-30039', 'D-50021', 'Demo - 07', N'DUBUQUE, IA - CHICAGO, IL', 182, 16, 198, 0.6300, 124.74),
    (@sid, 'O-20522', 'L-30040', 'D-50022', 'Demo - 07', N'DENVER, CO - OMAHA, NE', 537, 41, 578, 0.6300, 364.14),
    (@sid, 'O-20523', 'L-30041', 'D-50023', 'Demo - 07', N'ST. LOUIS, MO - NASHVILLE, TN', 309, 13, 322, 0.6300, 202.86);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Sfty Incentive', NULL, 50.00),
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Incentive Bonus', NULL, 134.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 3 DAYS', NULL, 213.00),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -77.41);
-- Settlement total: 691.74 + 319.59 = 1011.33

------------------------------------------------------------------------------
-- LENA HARTMAN -- paid 08/28
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('LHARTMAN', '2026-08-28', '2026-08-16', '2026-08-22', 'CK-260828-0007');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, load_id, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-20524', 'L-30042', 'D-50024', 'Demo - 07', N'DENVER, CO - OMAHA, NE', 537, 44, 581, 0.6300, 366.03),
    (@sid, 'O-20525', 'L-30043', 'D-50025', 'Demo - 07', N'DUBUQUE, IA - KANSAS CITY, MO', 322, 42, 364, 0.6300, 229.32),
    (@sid, 'O-20526', 'L-30044', 'D-50026', 'Demo - 07', N'SIOUX CITY, IA - OMAHA, NE', 95, 20, 115, 0.6300, 72.45),
    (@sid, 'O-20527', 'L-30045', 'D-50027', 'Demo - 07', N'MINNEAPOLIS, MN - MILWAUKEE, WI', 337, 19, 356, 0.6300, 224.28);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Incentive Bonus', NULL, 147.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 2 DAYS', NULL, 142.00),
    (@sid, 'REIMBURSEMENT', 'O-20524', NULL, N'TOLLS', NULL, 41.77),
    (@sid, 'REIMBURSEMENT', 'O-20525', NULL, N'MOTEL', NULL, 101.25),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -84.99),
    (@sid, 'DEDUCTION', NULL, NULL, N'ESCROW', NULL, -50.00);
-- Settlement total: 892.08 + 297.03 = 1189.11

------------------------------------------------------------------------------
-- EVERETT KLEIN -- paid 08/21
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('EKLEIN', '2026-08-21', '2026-08-09', '2026-08-15', 'CK-260821-0008');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, load_id, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-20528', 'L-30046', 'D-50028', 'Demo - 08', N'MILWAUKEE, WI - INDIANAPOLIS, IN', 279, 42, 321, 0.5900, 189.39),
    (@sid, 'O-20529', 'L-30047', 'D-50029', 'Demo - 08', N'DENVER, CO - OMAHA, NE', 537, 42, 579, 0.5900, 341.61),
    (@sid, 'O-20530', 'L-30048', 'D-50030', 'Demo - 08', N'DES MOINES, IA - DENVER, CO', 670, 12, 682, 0.5900, 402.38),
    (@sid, 'O-20531', 'L-30049', 'D-50031', 'Demo - 08', N'DUBUQUE, IA - CHICAGO, IL', 182, 13, 195, 0.5900, 115.05);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Sfty Incentive', NULL, 50.00),
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Incentive Bonus', NULL, 122.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 5 DAYS', NULL, 355.00),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -76.27),
    (@sid, 'DEDUCTION', NULL, NULL, N'ADVANCE', N'CD-94679', -182.00);
-- Settlement total: 1048.43 + 268.73 = 1317.16

------------------------------------------------------------------------------
-- EVERETT KLEIN -- paid 08/28
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('EKLEIN', '2026-08-28', '2026-08-16', '2026-08-22', 'CK-260828-0008');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, load_id, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-20532', 'L-30050', 'D-50032', 'Demo - 08', N'DENVER, CO - OMAHA, NE', 537, 21, 558, 0.5900, 329.22),
    (@sid, 'O-20533', 'L-30051', 'D-50033', 'Demo - 08', N'IOWA CITY, IA - MILWAUKEE, WI', 232, 42, 274, 0.5900, 161.66),
    (@sid, 'O-20534', 'L-30052', 'D-50034', 'Demo - 08', N'DUBUQUE, IA - KANSAS CITY, MO', 322, 38, 360, 0.5900, 212.40),
    (@sid, 'O-20535', 'L-30053', 'D-50035', 'Demo - 08', N'ST. LOUIS, MO - NASHVILLE, TN', 309, 34, 343, 0.5900, 202.37);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Sfty Incentive', NULL, 50.00),
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Incentive Bonus', NULL, 90.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 3 DAYS', NULL, 213.00),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -70.89),
    (@sid, 'DEDUCTION', NULL, NULL, N'ADVANCE', N'CD-96155', -145.00);
-- Settlement total: 905.65 + 137.11 = 1042.76

------------------------------------------------------------------------------
-- CYRUS NOLAN -- paid 08/21
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('CNOLAN', '2026-08-21', '2026-08-09', '2026-08-15', 'CK-260821-0009');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, load_id, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-20536', 'L-30054', 'D-50036', 'Demo - 09', N'MILWAUKEE, WI - INDIANAPOLIS, IN', 279, 41, 320, 0.6200, 198.40),
    (@sid, 'O-20537', 'L-30055', 'D-50037', 'Demo - 09', N'DUBUQUE, IA - ST. LOUIS, MO', 340, 12, 352, 0.6200, 218.24),
    (@sid, 'O-20538', 'L-30056', 'D-50038', 'Demo - 09', N'DES MOINES, IA - DENVER, CO', 670, 19, 689, 0.6200, 427.18),
    (@sid, 'O-20539', 'L-30057', 'D-50039', 'Demo - 09', N'DUBUQUE, IA - KANSAS CITY, MO', 322, 31, 353, 0.6200, 218.86);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 3 DAYS', NULL, 213.00),
    (@sid, 'REIMBURSEMENT', 'O-20536', NULL, N'TOLLS', NULL, 19.80),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -86.29);
-- Settlement total: 1062.68 + 146.51 = 1209.19

------------------------------------------------------------------------------
-- CYRUS NOLAN -- paid 08/28
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('CNOLAN', '2026-08-28', '2026-08-16', '2026-08-22', 'CK-260828-0009');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, load_id, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-20540', 'L-30058', 'D-50040', 'Demo - 09', N'IOWA CITY, IA - MILWAUKEE, WI', 232, 42, 274, 0.6200, 169.88),
    (@sid, 'O-20541', 'L-30059', 'D-50041', 'Demo - 09', N'DALLAS, TX - MEMPHIS, TN', 452, 33, 485, 0.6200, 300.70),
    (@sid, 'O-20542', 'L-30060', 'D-50042', 'Demo - 09', N'MINNEAPOLIS, MN - MILWAUKEE, WI', 337, 40, 377, 0.6200, 233.74),
    (@sid, 'O-20543', 'L-30061', 'D-50043', 'Demo - 09', N'MILWAUKEE, WI - INDIANAPOLIS, IN', 279, 37, 316, 0.6200, 195.92);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Sfty Incentive', NULL, 50.00),
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Incentive Bonus', NULL, 111.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 4 DAYS', NULL, 284.00),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -71.65);
-- Settlement total: 900.24 + 373.35 = 1273.59

------------------------------------------------------------------------------
-- JUNIOR PACE -- paid 08/21
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('JPACE', '2026-08-21', '2026-08-09', '2026-08-15', 'CK-260821-0011');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, load_id, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-20544', 'L-30062', 'D-50044', 'Demo - 11', N'OMAHA, NE - DUBUQUE, IA', 372, 15, 387, 0.5700, 220.59),
    (@sid, 'O-20545', 'L-30063', 'D-50045', 'Demo - 11', N'CEDAR RAPIDS, IA - ST. LOUIS, MO', 340, 34, 374, 0.5700, 213.18),
    (@sid, 'O-20546', 'L-30064', 'D-50046', 'Demo - 11', N'SIOUX CITY, IA - OMAHA, NE', 95, 33, 128, 0.5700, 72.96);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 5 DAYS', NULL, 355.00),
    (@sid, 'REIMBURSEMENT', 'O-20545', NULL, N'MOTEL', NULL, 83.51),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -92.54),
    (@sid, 'DEDUCTION', NULL, NULL, N'ESCROW', NULL, -50.00);
-- Settlement total: 506.73 + 295.97 = 802.70

------------------------------------------------------------------------------
-- JUNIOR PACE -- paid 08/28
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('JPACE', '2026-08-28', '2026-08-16', '2026-08-22', 'CK-260828-0011');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, load_id, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-20547', 'L-30065', 'D-50047', 'Demo - 11', N'MILWAUKEE, WI - INDIANAPOLIS, IN', 279, 11, 290, 0.5700, 165.30),
    (@sid, 'O-20548', 'L-30066', 'D-50048', 'Demo - 11', N'MEMPHIS, TN - DUBUQUE, IA', 612, 38, 650, 0.5700, 370.50),
    (@sid, 'O-20549', 'L-30067', 'D-50049', 'Demo - 11', N'CHICAGO, IL - DENVER, CO', 1003, 45, 1048, 0.5700, 597.36),
    (@sid, 'O-20550', 'L-30068', 'D-50050', 'Demo - 11', N'DALLAS, TX - MEMPHIS, TN', 452, 17, 469, 0.5700, 267.33);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Sfty Incentive', NULL, 50.00),
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Incentive Bonus', NULL, 94.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 5 DAYS', NULL, 355.00),
    (@sid, 'REIMBURSEMENT', 'O-20548', NULL, N'MOTEL', NULL, 89.89),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -86.69),
    (@sid, 'DEDUCTION', NULL, NULL, N'ADVANCE', N'CD-89073', -173.00);
-- Settlement total: 1400.49 + 329.20 = 1729.69

------------------------------------------------------------------------------
-- TANYA RUIZ -- paid 08/21
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('TRUIZ', '2026-08-21', '2026-08-09', '2026-08-15', 'CK-260821-0014');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, load_id, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-20551', 'L-30069', 'D-50051', 'Demo - 14', N'CEDAR RAPIDS, IA - ST. LOUIS, MO', 340, 37, 377, 0.6500, 245.05),
    (@sid, 'O-20552', 'L-30070', 'D-50052', 'Demo - 14', N'SIOUX CITY, IA - OMAHA, NE', 95, 43, 138, 0.6500, 89.70),
    (@sid, 'O-20553', 'L-30071', 'D-50053', 'Demo - 14', N'WATERLOO, IA - MINNEAPOLIS, MN', 246, 25, 271, 0.6500, 176.15),
    (@sid, 'O-20554', 'L-30072', 'D-50054', 'Demo - 14', N'KANSAS CITY, MO - DALLAS, TX', 552, 38, 590, 0.6500, 383.50);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Sfty Incentive', NULL, 50.00),
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Incentive Bonus', NULL, 89.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 2 DAYS', NULL, 142.00),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -80.20);
-- Settlement total: 894.40 + 200.80 = 1095.20

------------------------------------------------------------------------------
-- TANYA RUIZ -- paid 08/28
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('TRUIZ', '2026-08-28', '2026-08-16', '2026-08-22', 'CK-260828-0014');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, load_id, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-20555', 'L-30073', 'D-50055', 'Demo - 14', N'NASHVILLE, TN - CEDAR RAPIDS, IA', 621, 28, 649, 0.6500, 421.85),
    (@sid, 'O-20556', 'L-30074', 'D-50056', 'Demo - 14', N'DENVER, CO - OMAHA, NE', 537, 15, 552, 0.6500, 358.80),
    (@sid, 'O-20557', 'L-30075', 'D-50057', 'Demo - 14', N'OMAHA, NE - DUBUQUE, IA', 372, 43, 415, 0.6500, 269.75),
    (@sid, 'O-20558', 'L-30076', 'D-50058', 'Demo - 14', N'MEMPHIS, TN - DUBUQUE, IA', 612, 42, 654, 0.6500, 425.10);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Sfty Incentive', NULL, 50.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 2 DAYS', NULL, 142.00),
    (@sid, 'REIMBURSEMENT', 'O-20555', NULL, N'TOLLS', NULL, 37.54),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -82.98);
-- Settlement total: 1475.50 + 146.56 = 1622.06

------------------------------------------------------------------------------
-- MARCUS WEBB -- paid 08/21
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('MWEBB', '2026-08-21', '2026-08-09', '2026-08-15', 'CK-260821-0018');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, load_id, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-20559', 'L-30077', 'D-50059', 'Demo - 18', N'OMAHA, NE - DUBUQUE, IA', 372, 44, 416, 0.6000, 249.60),
    (@sid, 'O-20560', 'L-30078', 'D-50060', 'Demo - 18', N'KANSAS CITY, MO - DALLAS, TX', 552, 43, 595, 0.6000, 357.00),
    (@sid, 'O-20561', 'L-30079', 'D-50061', 'Demo - 18', N'DES MOINES, IA - DENVER, CO', 670, 35, 705, 0.6000, 423.00),
    (@sid, 'O-20562', 'L-30080', 'D-50062', 'Demo - 18', N'WATERLOO, IA - MINNEAPOLIS, MN', 246, 33, 279, 0.6000, 167.40);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Incentive Bonus', NULL, 137.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 4 DAYS', NULL, 284.00),
    (@sid, 'REIMBURSEMENT', 'O-20559', NULL, N'TOLLS', NULL, 17.26),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -93.54),
    (@sid, 'DEDUCTION', NULL, NULL, N'ADVANCE', N'CD-97596', -90.00),
    (@sid, 'DEDUCTION', NULL, NULL, N'ESCROW', NULL, -50.00);
-- Settlement total: 1197.00 + 204.72 = 1401.72

------------------------------------------------------------------------------
-- MARCUS WEBB -- paid 08/28
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('MWEBB', '2026-08-28', '2026-08-16', '2026-08-22', 'CK-260828-0018');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, load_id, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-20563', 'L-30081', 'D-50063', 'Demo - 18', N'KANSAS CITY, MO - DALLAS, TX', 552, 42, 594, 0.6000, 356.40),
    (@sid, 'O-20564', 'L-30082', 'D-50064', 'Demo - 18', N'DES MOINES, IA - DENVER, CO', 670, 35, 705, 0.6000, 423.00),
    (@sid, 'O-20565', 'L-30083', 'D-50065', 'Demo - 18', N'CEDAR RAPIDS, IA - ST. LOUIS, MO', 340, 42, 382, 0.6000, 229.20);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Sfty Incentive', NULL, 50.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 4 DAYS', NULL, 284.00),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -81.09);
-- Settlement total: 1008.60 + 252.91 = 1261.51

------------------------------------------------------------------------------
-- WANDA YATES -- paid 08/21
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('WYATES', '2026-08-21', '2026-08-09', '2026-08-15', 'CK-260821-0020');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, load_id, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-20566', 'L-30084', 'D-50066', 'Demo - 20', N'ST. LOUIS, MO - NASHVILLE, TN', 309, 20, 329, 0.6600, 217.14),
    (@sid, 'O-20567', 'L-30085', 'D-50067', 'Demo - 20', N'WATERLOO, IA - MINNEAPOLIS, MN', 246, 13, 259, 0.6600, 170.94),
    (@sid, 'O-20568', 'L-30086', 'D-50068', 'Demo - 20', N'KANSAS CITY, MO - DALLAS, TX', 552, 16, 568, 0.6600, 374.88),
    (@sid, 'O-20569', 'L-30087', 'D-50069', 'Demo - 20', N'DALLAS, TX - MEMPHIS, TN', 452, 29, 481, 0.6600, 317.46);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REVENUE', NULL, NULL, N'Wkly Sfty Incentive', NULL, 50.00),
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 4 DAYS', NULL, 284.00),
    (@sid, 'REIMBURSEMENT', 'O-20566', NULL, N'TOLLS', NULL, 53.15),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -79.50),
    (@sid, 'DEDUCTION', NULL, NULL, N'ESCROW', NULL, -50.00);
-- Settlement total: 1080.42 + 257.65 = 1338.07

------------------------------------------------------------------------------
-- WANDA YATES -- paid 08/28
------------------------------------------------------------------------------
INSERT INTO dbo.Settlements (driver_code, check_date, period_start, period_end, document_no)
VALUES ('WYATES', '2026-08-28', '2026-08-16', '2026-08-22', 'CK-260828-0020');
SET @sid = SCOPE_IDENTITY();

INSERT INTO dbo.SettlementRoutes
    (settlement_id, order_no, load_id, dispatch_no, unit_no, route_detail, loaded_miles, empty_miles, total_miles, pay_rate, pay_amount)
VALUES
    (@sid, 'O-20570', 'L-30088', 'D-50070', 'Demo - 20', N'CEDAR RAPIDS, IA - ST. LOUIS, MO', 340, 19, 359, 0.6600, 236.94),
    (@sid, 'O-20571', 'L-30089', 'D-50071', 'Demo - 20', N'NASHVILLE, TN - CEDAR RAPIDS, IA', 621, 22, 643, 0.6600, 424.38),
    (@sid, 'O-20572', 'L-30090', 'D-50072', 'Demo - 20', N'DUBUQUE, IA - ST. LOUIS, MO', 340, 38, 378, 0.6600, 249.48);

INSERT INTO dbo.SettlementLines (settlement_id, line_type, order_no, code, description, advance_reference, amount)
VALUES
    (@sid, 'REIMBURSEMENT', NULL, NULL, N'PER DIEM - 4 DAYS', NULL, 284.00),
    (@sid, 'REIMBURSEMENT', 'O-20570', NULL, N'TOLLS', NULL, 20.47),
    (@sid, 'DEDUCTION', NULL, NULL, N'MEDICAL INSURANCE', NULL, -91.00);
-- Settlement total: 910.80 + 213.47 = 1124.27
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
WHERE s.driver_code IN ('HBARNETT', 'RDELGADO', 'DFOSTER', 'LHARTMAN', 'EKLEIN', 'CNOLAN', 'JPACE', 'TRUIZ', 'MWEBB', 'WYATES')
ORDER BY s.driver_code, s.check_date DESC;
