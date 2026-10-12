-- fleet_01_ddl.sql
-- The trucks and the trailers, as things in their own right.
--
-- Until now a truck was a string. Drivers.unit_no said which one an
-- owner/operator drives, SettlementRoutes.unit_no said which one ran a paid
-- trip, and Loads.unit_no (loads_04_dispatch.sql) said which one is on a
-- load -- three columns of free text agreeing by luck. A typo in any of them
-- invented a truck. There was nowhere to say a truck is in the shop, when its
-- registration runs out, or which one has a plate that expires next week.
--
-- dbo.Trucks and dbo.Trailers are those places. Loads.unit_no and
-- Drivers.unit_no become foreign keys to Trucks; a new Loads.trailer_no
-- points at Trailers. SettlementRoutes.unit_no stays free text on purpose:
-- it is a historical record of what the statement said, and a truck sold
-- since must not make an old settlement unreadable.
--
-- Unit numbers match the vehicle names in the demo_millstream MyGeotab
-- database ("Demo - 01" .. "Demo - 24"), so the two systems agree by NAME the
-- same way the routes do. See src/lib/geotab.js for why that is the whole
-- integration and what its one weakness is.
--
-- Run as sqlmillstream (db_owner). Requires loads_04_dispatch.sql and
-- settlement_06_owner.sql. Safe to re-run: everything is guarded and the
-- seeds MERGE.

SET NOCOUNT ON;
GO

------------------------------------------------------------------------------
-- Trucks
------------------------------------------------------------------------------
IF OBJECT_ID(N'dbo.Trucks', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Trucks (
        unit_no             VARCHAR(20)   NOT NULL,
        description         NVARCHAR(80)  NOT NULL,   -- "2021 Freightliner Cascadia", what people say
        model_year          SMALLINT      NULL,
        make                NVARCHAR(40)  NULL,
        model               NVARCHAR(40)  NULL,
        vin                 VARCHAR(17)   NULL,
        plate               VARCHAR(12)   NULL,
        plate_state         NCHAR(2)      NULL,

        -- Active   in service
        -- Shop     down for repair or PM; not assignable
        -- Retired  sold, wrecked, or returned; kept so old loads still resolve
        status              VARCHAR(10)   NOT NULL CONSTRAINT DF_Trucks_status DEFAULT 'Active',

        -- COMPANY   the carrier's own
        -- OWNER     an owner/operator's, and owner_driver_code says whose
        owner_type          VARCHAR(10)   NOT NULL CONSTRAINT DF_Trucks_owner DEFAULT 'COMPANY',
        owner_driver_code   VARCHAR(20)   NULL,

        registration_expires DATE         NULL,
        inspection_due       DATE         NULL,   -- annual DOT inspection
        notes               NVARCHAR(400) NULL,

        created_utc         DATETIME2(0)  NOT NULL CONSTRAINT DF_Trucks_created DEFAULT SYSUTCDATETIME(),
        updated_utc         DATETIME2(0)  NULL,
        updated_by          NVARCHAR(256) NULL,

        CONSTRAINT PK_Trucks PRIMARY KEY (unit_no),
        CONSTRAINT CK_Trucks_status CHECK (status IN ('Active', 'Shop', 'Retired')),
        CONSTRAINT CK_Trucks_owner_type CHECK (owner_type IN ('COMPANY', 'OWNER')),
        -- An owner/operator's truck names its owner; a company truck names nobody.
        CONSTRAINT CK_Trucks_owner CHECK (
            (owner_type = 'OWNER' AND owner_driver_code IS NOT NULL) OR
            (owner_type = 'COMPANY' AND owner_driver_code IS NULL)
        ),
        CONSTRAINT FK_Trucks_owner FOREIGN KEY (owner_driver_code) REFERENCES dbo.Drivers (driver_code)
    );
    PRINT 'CREATED dbo.Trucks';
END
ELSE
    PRINT 'dbo.Trucks already exists';
GO

------------------------------------------------------------------------------
-- Trailers
------------------------------------------------------------------------------
IF OBJECT_ID(N'dbo.Trailers', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Trailers (
        trailer_no          VARCHAR(20)   NOT NULL,
        -- The same three words the load board uses for equipment, so a
        -- Reefer load can be offered Reefer trailers without a mapping table.
        trailer_type        NVARCHAR(50)  NOT NULL,
        description         NVARCHAR(80)  NULL,    -- "53' Utility 3000R", length, make
        plate               VARCHAR(12)   NULL,
        plate_state         NCHAR(2)      NULL,
        status              VARCHAR(10)   NOT NULL CONSTRAINT DF_Trailers_status DEFAULT 'Active',
        registration_expires DATE         NULL,
        inspection_due       DATE         NULL,
        notes               NVARCHAR(400) NULL,

        created_utc         DATETIME2(0)  NOT NULL CONSTRAINT DF_Trailers_created DEFAULT SYSUTCDATETIME(),
        updated_utc         DATETIME2(0)  NULL,
        updated_by          NVARCHAR(256) NULL,

        CONSTRAINT PK_Trailers PRIMARY KEY (trailer_no),
        CONSTRAINT CK_Trailers_type CHECK (trailer_type IN (N'Dry Van', N'Reefer', N'Flatbed')),
        CONSTRAINT CK_Trailers_status CHECK (status IN ('Active', 'Shop', 'Retired'))
    );
    PRINT 'CREATED dbo.Trailers';
END
ELSE
    PRINT 'dbo.Trailers already exists';
GO

------------------------------------------------------------------------------
-- Seed: the 24 trucks MyGeotab already knows about.
--
-- Demo - 01..20 are company trucks, matched to the driver who sits in them
-- in MyGeotab (driver-vehicles.json). Demo - 21..24 belong to the four
-- owner/operators and carry the descriptions their settlements print.
--
-- Registration and inspection dates are spread across the coming year so the
-- fleet page has something to warn about: 03 and 17 expire within the month,
-- and 11 is in the shop. VINs are left NULL rather than invented -- a made-up
-- VIN is a lie a scale house can check.
------------------------------------------------------------------------------
MERGE dbo.Trucks AS target
USING (VALUES
    ('Demo - 01', N'2021 Freightliner Cascadia', 2021, N'Freightliner', N'Cascadia',  'ML 4471', N'IA', 'Active', 'COMPANY', NULL,        '2027-03-31', '2027-01-15'),
    ('Demo - 02', N'2020 Volvo VNL 760',         2020, N'Volvo',        N'VNL 760',   'ML 4472', N'IA', 'Active', 'COMPANY', NULL,        '2027-03-31', '2026-11-20'),
    ('Demo - 03', N'2019 Kenworth T680',         2019, N'Kenworth',     N'T680',      'ML 4473', N'IA', 'Active', 'COMPANY', NULL,        '2026-09-30', '2026-12-05'),
    ('Demo - 04', N'2022 Freightliner Cascadia', 2022, N'Freightliner', N'Cascadia',  'ML 4474', N'IA', 'Active', 'COMPANY', NULL,        '2027-03-31', '2027-02-10'),
    ('Demo - 05', N'2021 Peterbilt 579',         2021, N'Peterbilt',    N'579',       'ML 4475', N'IA', 'Active', 'COMPANY', NULL,        '2027-03-31', '2026-10-28'),
    ('Demo - 06', N'2023 International LT',      2023, N'International',N'LT',        'ML 4476', N'IA', 'Active', 'COMPANY', NULL,        '2027-06-30', '2027-04-01'),
    ('Demo - 07', N'2020 Freightliner Cascadia', 2020, N'Freightliner', N'Cascadia',  'ML 4477', N'IA', 'Active', 'COMPANY', NULL,        '2027-03-31', '2026-12-18'),
    ('Demo - 08', N'2022 Volvo VNL 860',         2022, N'Volvo',        N'VNL 860',   'ML 4478', N'IA', 'Active', 'COMPANY', NULL,        '2027-03-31', '2027-03-05'),
    ('Demo - 09', N'2019 Peterbilt 579',         2019, N'Peterbilt',    N'579',       'ML 4479', N'IA', 'Active', 'COMPANY', NULL,        '2027-03-31', '2026-11-02'),
    ('Demo - 10', N'2021 Kenworth T680',         2021, N'Kenworth',     N'T680',      'ML 4480', N'IA', 'Active', 'COMPANY', NULL,        '2027-03-31', '2027-01-30'),
    ('Demo - 11', N'2018 Freightliner Cascadia', 2018, N'Freightliner', N'Cascadia',  'ML 4481', N'IA', 'Shop',   'COMPANY', NULL,        '2027-03-31', '2026-10-10'),
    ('Demo - 12', N'2023 Freightliner Cascadia', 2023, N'Freightliner', N'Cascadia',  'ML 4482', N'IA', 'Active', 'COMPANY', NULL,        '2027-06-30', '2027-05-12'),
    ('Demo - 13', N'2020 International LT',      2020, N'International',N'LT',        'ML 4483', N'IA', 'Active', 'COMPANY', NULL,        '2027-03-31', '2026-12-22'),
    ('Demo - 14', N'2022 Kenworth T680',         2022, N'Kenworth',     N'T680',      'ML 4484', N'IA', 'Active', 'COMPANY', NULL,        '2027-03-31', '2027-02-25'),
    ('Demo - 15', N'2021 Volvo VNL 760',         2021, N'Volvo',        N'VNL 760',   'ML 4485', N'IA', 'Active', 'COMPANY', NULL,        '2027-03-31', '2027-01-08'),
    ('Demo - 16', N'2019 Freightliner Cascadia', 2019, N'Freightliner', N'Cascadia',  'ML 4486', N'IA', 'Active', 'COMPANY', NULL,        '2027-03-31', '2026-11-14'),
    ('Demo - 17', N'2020 Peterbilt 579',         2020, N'Peterbilt',    N'579',       'ML 4487', N'IA', 'Active', 'COMPANY', NULL,        '2026-10-05', '2026-09-25'),
    ('Demo - 18', N'2023 Volvo VNL 860',         2023, N'Volvo',        N'VNL 860',   'ML 4488', N'IA', 'Active', 'COMPANY', NULL,        '2027-06-30', '2027-04-20'),
    ('Demo - 19', N'2022 International LT',      2022, N'International',N'LT',        'ML 4489', N'IA', 'Active', 'COMPANY', NULL,        '2027-03-31', '2027-03-15'),
    ('Demo - 20', N'2021 Freightliner Cascadia', 2021, N'Freightliner', N'Cascadia',  'ML 4490', N'IA', 'Active', 'COMPANY', NULL,        '2027-03-31', '2026-12-01'),
    ('Demo - 21', N'2021 Freightliner Cascadia', 2021, N'Freightliner', N'Cascadia',  'OO 2101', N'IA', 'Active', 'OWNER',   'RVASQUEZ',  '2027-02-28', '2027-01-20'),
    ('Demo - 22', N'2020 Peterbilt 579',         2020, N'Peterbilt',    N'579',       'OO 2202', N'IL', 'Active', 'OWNER',   'KBRENNAN', '2027-01-31', '2026-11-30'),
    ('Demo - 23', N'2022 Kenworth T680',         2022, N'Kenworth',     N'T680',      'OO 2303', N'IA', 'Active', 'OWNER',   'MOKONKWO', '2027-04-30', '2027-02-14'),
    ('Demo - 24', N'2021 Volvo VNL 860',         2021, N'Volvo',        N'VNL 860',   'OO 2404', N'WI', 'Active', 'OWNER',   'LSTAVROS', '2027-03-31', '2027-03-01')
) AS source (unit_no, description, model_year, make, model, plate, plate_state, status, owner_type, owner_driver_code, registration_expires, inspection_due)
ON target.unit_no = source.unit_no
WHEN NOT MATCHED THEN
    INSERT (unit_no, description, model_year, make, model, plate, plate_state, status, owner_type, owner_driver_code, registration_expires, inspection_due)
    VALUES (source.unit_no, source.description, source.model_year, source.make, source.model, source.plate, source.plate_state, source.status, source.owner_type, source.owner_driver_code, source.registration_expires, source.inspection_due);
DECLARE @trucks INT = (SELECT COUNT(*) FROM dbo.Trucks);
PRINT 'Trucks seeded: ' + CAST(@trucks AS varchar(10));
GO

------------------------------------------------------------------------------
-- Seed: trailers. Numbered by type so the number alone says what it is:
-- T-1xx dry vans, T-2xx reefers, T-3xx flatbeds. Owner/operators pull the
-- carrier's trailers, so there is no owner column here.
------------------------------------------------------------------------------
MERGE dbo.Trailers AS target
USING (VALUES
    ('T-101', N'Dry Van', N'53'' Wabash DuraPlate',     'TR 1101', N'IA', 'Active', '2027-03-31', '2027-01-10'),
    ('T-102', N'Dry Van', N'53'' Wabash DuraPlate',     'TR 1102', N'IA', 'Active', '2027-03-31', '2026-12-12'),
    ('T-103', N'Dry Van', N'53'' Great Dane Champion',  'TR 1103', N'IA', 'Active', '2027-03-31', '2026-10-02'),
    ('T-104', N'Dry Van', N'53'' Great Dane Champion',  'TR 1104', N'IA', 'Active', '2027-03-31', '2027-02-18'),
    ('T-105', N'Dry Van', N'53'' Hyundai Translead',    'TR 1105', N'IA', 'Active', '2026-09-28', '2026-11-05'),
    ('T-106', N'Dry Van', N'53'' Hyundai Translead',    'TR 1106', N'IA', 'Active', '2027-03-31', '2027-03-22'),
    ('T-107', N'Dry Van', N'53'' Wabash DuraPlate',     'TR 1107', N'IA', 'Shop',   '2027-03-31', '2026-10-15'),
    ('T-108', N'Dry Van', N'53'' Utility 4000D-X',      'TR 1108', N'IA', 'Active', '2027-03-31', '2027-01-25'),
    ('T-109', N'Dry Van', N'53'' Utility 4000D-X',      'TR 1109', N'IA', 'Active', '2027-03-31', '2026-12-30'),
    ('T-110', N'Dry Van', N'53'' Great Dane Champion',  'TR 1110', N'IA', 'Active', '2027-03-31', '2027-02-02'),
    ('T-111', N'Dry Van', N'48'' Wabash DuraPlate',     'TR 1111', N'IA', 'Active', '2027-03-31', '2026-11-19'),
    ('T-112', N'Dry Van', N'53'' Hyundai Translead',    'TR 1112', N'IA', 'Active', '2027-03-31', '2027-03-08'),
    ('T-201', N'Reefer',  N'53'' Utility 3000R / Carrier X4', 'TR 2201', N'IA', 'Active', '2027-03-31', '2027-01-14'),
    ('T-202', N'Reefer',  N'53'' Utility 3000R / Carrier X4', 'TR 2202', N'IA', 'Active', '2027-03-31', '2026-12-08'),
    ('T-203', N'Reefer',  N'53'' Great Dane Everest / TK S-600', 'TR 2203', N'IA', 'Active', '2027-03-31', '2026-10-22'),
    ('T-204', N'Reefer',  N'53'' Great Dane Everest / TK S-600', 'TR 2204', N'IA', 'Active', '2027-03-31', '2027-02-27'),
    ('T-205', N'Reefer',  N'53'' Wabash ArcticLite / Carrier X4', 'TR 2205', N'IA', 'Active', '2027-03-31', '2026-11-11'),
    ('T-206', N'Reefer',  N'53'' Wabash ArcticLite / Carrier X4', 'TR 2206', N'IA', 'Active', '2027-03-31', '2027-03-17'),
    ('T-207', N'Reefer',  N'53'' Utility 3000R / TK Precedent', 'TR 2207', N'IA', 'Active', '2026-10-12', '2026-09-30'),
    ('T-208', N'Reefer',  N'53'' Utility 3000R / TK Precedent', 'TR 2208', N'IA', 'Active', '2027-03-31', '2027-01-29'),
    ('T-209', N'Reefer',  N'53'' Great Dane Everest / Carrier X4', 'TR 2209', N'IA', 'Active', '2027-03-31', '2026-12-19'),
    ('T-210', N'Reefer',  N'53'' Wabash ArcticLite / TK S-600', 'TR 2210', N'IA', 'Active', '2027-03-31', '2027-02-09'),
    ('T-301', N'Flatbed', N'48'' Fontaine Infinity',    'TR 3301', N'IA', 'Active', '2027-03-31', '2027-01-06'),
    ('T-302', N'Flatbed', N'48'' Fontaine Infinity',    'TR 3302', N'IA', 'Active', '2027-03-31', '2026-11-26'),
    ('T-303', N'Flatbed', N'53'' Fontaine Revolution',  'TR 3303', N'IA', 'Active', '2027-03-31', '2026-10-30'),
    ('T-304', N'Flatbed', N'48'' Great Dane Freedom LT', 'TR 3304', N'IA', 'Active', '2027-03-31', '2027-02-21'),
    ('T-305', N'Flatbed', N'48'' Great Dane Freedom LT', 'TR 3305', N'IA', 'Active', '2027-03-31', '2026-12-15'),
    ('T-306', N'Flatbed', N'48'' Fontaine Infinity',    'TR 3306', N'IA', 'Active', '2027-03-31', '2027-03-12'),
    ('T-307', N'Flatbed', N'53'' Fontaine Revolution',  'TR 3307', N'IA', 'Active', '2027-03-31', '2027-01-19'),
    ('T-308', N'Flatbed', N'48'' Reitnouer MaxMiser',   'TR 3308', N'IA', 'Retired', '2026-03-31', '2026-02-01')
) AS source (trailer_no, trailer_type, description, plate, plate_state, status, registration_expires, inspection_due)
ON target.trailer_no = source.trailer_no
WHEN NOT MATCHED THEN
    INSERT (trailer_no, trailer_type, description, plate, plate_state, status, registration_expires, inspection_due)
    VALUES (source.trailer_no, source.trailer_type, source.description, source.plate, source.plate_state, source.status, source.registration_expires, source.inspection_due);
DECLARE @trailers INT = (SELECT COUNT(*) FROM dbo.Trailers);
PRINT 'Trailers seeded: ' + CAST(@trailers AS varchar(10));
GO

------------------------------------------------------------------------------
-- Every company driver gets their regular truck, matched to MyGeotab.
--
-- Drivers.unit_no existed only for the four owner/operators. The roster
-- defaults the unit box to this when a driver is picked, so filling it in
-- for the other twenty is what makes assignment one click instead of two.
-- Only rows still NULL are touched: a truck changed by hand stays changed.
------------------------------------------------------------------------------
UPDATE d
   SET d.unit_no = m.unit_no, d.truck_description = t.description
  FROM dbo.Drivers AS d
  JOIN (VALUES
    ('HBARNETT', 'Demo - 01'), ('TBOONE', 'Demo - 02'), ('ACORTEZ', 'Demo - 03'), ('RDELGADO', 'Demo - 04'),
    ('DFOSTER', 'Demo - 05'), ('DFRYE', 'Demo - 06'), ('LHARTMAN', 'Demo - 07'), ('EKLEIN', 'Demo - 08'),
    ('CNOLAN', 'Demo - 09'), ('SOAKS', 'Demo - 10'), ('JPACE', 'Demo - 11'), ('NPRUITT', 'Demo - 12'),
    ('PRAMAN', 'Demo - 13'), ('TRUIZ', 'Demo - 14'), ('JSMITH', 'Demo - 15'), ('ISOLBERG', 'Demo - 16'),
    ('OVAUGHN', 'Demo - 17'), ('MWEBB', 'Demo - 18'), ('GWHITFIELD', 'Demo - 19'), ('WYATES', 'Demo - 20')
  ) AS m (driver_code, unit_no) ON m.driver_code = d.driver_code
  JOIN dbo.Trucks AS t ON t.unit_no = m.unit_no
 WHERE d.unit_no IS NULL;
PRINT CAST(@@ROWCOUNT AS varchar(10)) + ' company drivers given their regular truck';
GO

------------------------------------------------------------------------------
-- Now that every unit number that is referenced exists, the references
-- become foreign keys. Any value that would fail these is a typo, and the
-- point of the table is to catch it.
------------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Drivers_truck')
BEGIN
    ALTER TABLE dbo.Drivers ADD CONSTRAINT FK_Drivers_truck
        FOREIGN KEY (unit_no) REFERENCES dbo.Trucks (unit_no);
    PRINT 'ADDED FK_Drivers_truck';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Loads_truck')
BEGIN
    ALTER TABLE dbo.Loads ADD CONSTRAINT FK_Loads_truck
        FOREIGN KEY (unit_no) REFERENCES dbo.Trucks (unit_no);
    PRINT 'ADDED FK_Loads_truck';
END
GO

IF COL_LENGTH(N'dbo.Loads', N'trailer_no') IS NULL
BEGIN
    ALTER TABLE dbo.Loads ADD trailer_no VARCHAR(20) NULL;
    PRINT 'ADDED Loads.trailer_no';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Loads_trailer')
BEGIN
    ALTER TABLE dbo.Loads ADD CONSTRAINT FK_Loads_trailer
        FOREIGN KEY (trailer_no) REFERENCES dbo.Trailers (trailer_no);
    PRINT 'ADDED FK_Loads_trailer';
END
GO

------------------------------------------------------------------------------
-- What the schema now looks like
------------------------------------------------------------------------------
SELECT 'Trucks'             AS item, (SELECT COUNT(*) FROM dbo.Trucks)   AS present
UNION ALL SELECT 'Trailers',          (SELECT COUNT(*) FROM dbo.Trailers)
UNION ALL SELECT 'Drivers with a truck', (SELECT COUNT(*) FROM dbo.Drivers WHERE unit_no IS NOT NULL)
UNION ALL SELECT 'Loads.trailer_no',  COL_LENGTH(N'dbo.Loads', N'trailer_no')
UNION ALL SELECT 'FK_Loads_truck',    CASE WHEN EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Loads_truck') THEN 1 ELSE NULL END;
GO
