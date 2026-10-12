------------------------------------------------------------------------------
-- loads_06_southwest.sql -- five loads where the trucks actually are.
--
-- THE PROBLEM THIS SOLVES. Millstream's freight runs the Midwest. The GeoTab
-- demo database's vehicles drive simulated loops around Las Vegas, and that
-- simulation is not ours to move: positions come from devices, and unlike
-- duty status logs there is no "manual" origin the API will accept for them.
-- So every live feature this app has built -- the truck on the map, the ETA,
-- "Truck now" -- correctly answers "that truck is fifteen hundred miles from
-- this load" and shows nothing. Right, and useless as a demonstration.
--
-- Rather than falsify where the trucks are, this adds freight where they are.
-- Five current loads on real Southwest lanes, assigned to Demo - 01..05,
-- whose drivers are the ones reporting positions near Las Vegas. On these
-- loads the ETA has a truck near the lane to measure from and the map has a
-- truck to draw.
--
-- WHAT IT DOES NOT TOUCH. Every existing load, every settlement, every
-- invoice and the whole delivered history stay exactly as they are. Nothing
-- here rewrites a Midwest lane into a Nevada one; a carrier that picked up
-- some Southwest work is an ordinary thing, and a carrier whose historical
-- freight silently moved across the country is not.
--
-- BEFORE THIS IS USEFUL: the new cities need GeoTab zones, or the map has no
-- coordinates for them and the ETA refuses with "no zone for LAS VEGAS, NV".
-- geotab-add-zones.ps1 reads its lane list out of these SQL files, so it
-- picks these up on its own:
--
--     .\geotab-add-zones.ps1 -Database demo_millstream -FromLanes -WhatIf
--     .\geotab-add-zones.ps1 -Database demo_millstream -FromLanes
--
-- Re-running this script is safe: every insert is guarded on the load id.
------------------------------------------------------------------------------

SET NOCOUNT ON;
GO

------------------------------------------------------------------------------
-- The customers. Two new ones, because these lanes are not the Midwest
-- customers' freight and pretending otherwise would put Nevada produce on a
-- Dubuque shipper's account -- which is the sort of thing that looks fine
-- until somebody runs an invoice.
------------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM dbo.Customers WHERE name = N'Mojave Cold Chain')
BEGIN
    -- address1, not address. The seed insert in customers_01_ddl.sql lists no
    -- column names, so this file guessed one from the shape of its VALUES and
    -- guessed wrong; the customers failed and the loads below went in with a
    -- customer NAME and no customer_id. Hence the repair step that follows.
    INSERT INTO dbo.Customers
        (name, customer_type, mc_number, address1, city, state, postal_code, phone, email, contact_name, payment_terms_days, credit_limit, status)
    VALUES
        (N'Mojave Cold Chain', 'Shipper', NULL, N'4600 W Sunset Rd', N'Las Vegas', N'NV', '89118',
         '702-555-0132', N'dispatch@mojavecold.example', N'Ruth Alvarado', 30, NULL, 'Active'),
        (N'Sunbelt Freight Brokers', 'Broker', 'MC-904115', N'2100 E Camelback Rd Ste 400', N'Phoenix', N'AZ', '85016',
         '602-555-0178', N'carriers@sunbeltfb.example', N'Errol Nakamura', 21, 35000.00, 'Active');
    PRINT 'INSERTED 2 Southwest customers';
END
ELSE
    PRINT 'Southwest customers already present';
GO

------------------------------------------------------------------------------
-- Link any Southwest load that has a customer's NAME but not their id.
--
-- Only does anything when the customers failed to insert on an earlier run
-- and the loads went in anyway -- which is exactly what happened the first
-- time this file was run. Matching on the name is safe here because these
-- five rows wrote both, from the same literal, in the same statement.
--
-- Without this, the loads carry a customer nobody can click through to, the
-- hold rule in loadRules.planChange has no customer to check, and an invoice
-- run has nobody to bill.
------------------------------------------------------------------------------
UPDATE l
   SET l.customer_id = c.customer_id
  FROM dbo.Loads AS l
  JOIN dbo.Customers AS c ON c.name = l.customer_name
 WHERE l.id LIKE 'L-105%'
   AND l.customer_id IS NULL;

IF @@ROWCOUNT > 0 PRINT 'LINKED Southwest loads to their customers';
GO

------------------------------------------------------------------------------
-- The loads.
--
-- Dates are relative to whenever this is run, so the board is never showing
-- freight that was due last spring. CAST to DATETIME2(0) because the windows
-- are naive local time at the dock -- see the note in loads_04_dispatch.sql.
--
-- Two In Transit, two Covered, one Available: enough for the ETA to have
-- something to measure on, and one that has not been assigned so the dispatch
-- panel still has work to do.
------------------------------------------------------------------------------
DECLARE @today DATE = CAST(SYSDATETIME() AS DATE);
DECLARE @mojave INT = (SELECT customer_id FROM dbo.Customers WHERE name = N'Mojave Cold Chain');
DECLARE @sunbelt INT = (SELECT customer_id FROM dbo.Customers WHERE name = N'Sunbelt Freight Brokers');

IF NOT EXISTS (SELECT 1 FROM dbo.Loads WHERE id = 'L-10501')
BEGIN
    INSERT INTO dbo.Loads
        (id, origin, destination, miles, empty_miles, rate, equipment, status,
         driver_code, unit_no, customer_id, customer_name, reference_no,
         pickup_start, pickup_end, delivery_start, delivery_end,
         shipper_name, shipper_address, shipper_phone,
         consignee_name, consignee_address, consignee_phone,
         commodity, weight_lbs, temp_f)
    VALUES
    -- Las Vegas to Phoenix: the short haul the fleet could actually be on
    -- right now, and the one where an ETA is worth reading.
    ('L-10501', N'Las Vegas, NV', N'Phoenix, AZ', 297, 22, 1128.60, N'Reefer', N'In Transit',
     'HBARNETT', 'Demo - 01', @mojave, N'Mojave Cold Chain', N'MOJ104221',
     DATEADD(HOUR, 7,  CAST(@today AS DATETIME2(0))), DATEADD(HOUR, 11, CAST(@today AS DATETIME2(0))),
     DATEADD(HOUR, 17, CAST(@today AS DATETIME2(0))), DATEADD(HOUR, 21, CAST(@today AS DATETIME2(0))),
     N'Mojave Cold Chain', N'4600 W Sunset Rd', '702-555-0132',
     N'Desert Fresh Distribution', N'3820 S 35th Ave', '602-555-0144',
     N'Chilled produce', 41200, 34),

    ('L-10502', N'Henderson, NV', N'Los Angeles, CA', 271, 14, 1002.70, N'Dry Van', N'In Transit',
     'TBOONE', 'Demo - 02', @sunbelt, N'Sunbelt Freight Brokers', N'SUN550118',
     DATEADD(HOUR, 6,  CAST(@today AS DATETIME2(0))), DATEADD(HOUR, 10, CAST(@today AS DATETIME2(0))),
     DATEADD(HOUR, 16, CAST(@today AS DATETIME2(0))), DATEADD(HOUR, 20, CAST(@today AS DATETIME2(0))),
     N'Basin Packaging Co.', N'1250 American Pacific Dr', '702-555-0117',
     N'Harbor Retail DC', N'19200 S Alameda St', '310-555-0192',
     N'Corrugated packaging', 28400, NULL),

    -- Three stops, so the ETA has more than one arrival to report and the
    -- map has a lane with a middle to it.
    ('L-10503', N'North Las Vegas, NV', N'Salt Lake City, UT', 421, 31, 1557.70, N'Dry Van', N'Covered',
     'ACORTEZ', 'Demo - 03', @sunbelt, N'Sunbelt Freight Brokers', N'SUN550119',
     DATEADD(HOUR, 30, CAST(@today AS DATETIME2(0))), DATEADD(HOUR, 34, CAST(@today AS DATETIME2(0))),
     DATEADD(HOUR, 44, CAST(@today AS DATETIME2(0))), DATEADD(HOUR, 48, CAST(@today AS DATETIME2(0))),
     N'Silver State Plastics', N'3200 N Las Vegas Blvd', '702-555-0166',
     N'Wasatch Supply Group', N'1775 S 4800 W', '801-555-0129',
     N'Injection mouldings', 33900, NULL),

    ('L-10504', N'Las Vegas, NV', N'Flagstaff, AZ', 251, 18, 953.80, N'Reefer', N'Covered',
     'RDELGADO', 'Demo - 04', @mojave, N'Mojave Cold Chain', N'MOJ104222',
     DATEADD(HOUR, 31, CAST(@today AS DATETIME2(0))), DATEADD(HOUR, 35, CAST(@today AS DATETIME2(0))),
     DATEADD(HOUR, 41, CAST(@today AS DATETIME2(0))), DATEADD(HOUR, 45, CAST(@today AS DATETIME2(0))),
     N'Mojave Cold Chain', N'4600 W Sunset Rd', '702-555-0132',
     N'High Country Grocers', N'2200 E Butler Ave', '928-555-0155',
     N'Dairy', 38600, 36),

    -- Unassigned on purpose: something for dispatch to cover, and the only
    -- one of these five where the ETA correctly says nothing at all.
    ('L-10505', N'Barstow, CA', N'Las Vegas, NV', 158, 0, 617.00, N'Flatbed', N'Available',
     NULL, NULL, @sunbelt, N'Sunbelt Freight Brokers', N'SUN550120',
     DATEADD(HOUR, 54, CAST(@today AS DATETIME2(0))), DATEADD(HOUR, 58, CAST(@today AS DATETIME2(0))),
     DATEADD(HOUR, 64, CAST(@today AS DATETIME2(0))), DATEADD(HOUR, 68, CAST(@today AS DATETIME2(0))),
     N'Mojave Aggregates', N'2800 Lenwood Rd', '760-555-0188',
     N'Valley Steel Service', N'4055 W Cheyenne Ave', '702-555-0173',
     N'Structural steel', 44100, NULL);

    PRINT 'INSERTED 5 Southwest loads (L-10501..L-10505)';
END
ELSE
    PRINT 'Southwest loads already present';
GO

------------------------------------------------------------------------------
-- The stops.
--
-- The API rewrites the six summary columns above from the first and last stop
-- (stopRules.summaryFrom), so these must agree with what was inserted -- and
-- the place strings must match the GeoTab zone names, since that name IS the
-- join that gives a stop its coordinates.
--
-- L-10501 and L-10502 are already rolling, so their pickups carry an arrival
-- and a departure. That is what makes them In Transit, and it is what makes
-- the ETA answer about the stop still ahead rather than the one behind.
------------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM dbo.LoadStops WHERE load_id = 'L-10501')
BEGIN
    DECLARE @now DATETIME2(0) = CAST(SYSUTCDATETIME() AS DATETIME2(0));
    DECLARE @day DATETIME2(0) = CAST(CAST(SYSDATETIME() AS DATE) AS DATETIME2(0));

    INSERT INTO dbo.LoadStops (load_id, seq, stop_type, place, name, address, phone, window_start, window_end, reference_no, notes, arrived_utc, departed_utc)
    VALUES
    ('L-10501', 1, 'Pickup',   N'Las Vegas, NV',       N'Mojave Cold Chain',         N'4600 W Sunset Rd',          '702-555-0132', DATEADD(HOUR, 7,  @day), DATEADD(HOUR, 11, @day), N'PU-880141', N'reefer 34F, pulp on arrival', DATEADD(MINUTE, -210, @now), DATEADD(MINUTE, -160, @now)),
    ('L-10501', 2, 'Delivery', N'Phoenix, AZ',         N'Desert Fresh Distribution', N'3820 S 35th Ave',           '602-555-0144', DATEADD(HOUR, 17, @day), DATEADD(HOUR, 21, @day), N'PO-330915', N'dock 6, lumper on site',      NULL, NULL),

    ('L-10502', 1, 'Pickup',   N'Henderson, NV',       N'Basin Packaging Co.',       N'1250 American Pacific Dr',  '702-555-0117', DATEADD(HOUR, 6,  @day), DATEADD(HOUR, 10, @day), N'PU-880142', NULL, DATEADD(MINUTE, -250, @now), DATEADD(MINUTE, -195, @now)),
    ('L-10502', 2, 'Delivery', N'Los Angeles, CA',     N'Harbor Retail DC',          N'19200 S Alameda St',        '310-555-0192', DATEADD(HOUR, 16, @day), DATEADD(HOUR, 20, @day), N'PO-330916', N'appointment firm', NULL, NULL),

    ('L-10503', 1, 'Pickup',   N'North Las Vegas, NV', N'Silver State Plastics',     N'3200 N Las Vegas Blvd',     '702-555-0166', DATEADD(HOUR, 30, @day), DATEADD(HOUR, 34, @day), N'PU-880143', NULL, NULL, NULL),
    ('L-10503', 2, 'Delivery', N'St. George, UT',      N'Red Cliffs Outfitters',     N'1450 S River Rd',           '435-555-0121', DATEADD(HOUR, 37, @day), DATEADD(HOUR, 39, @day), N'PO-330917', N'partial, 6 pallets', NULL, NULL),
    ('L-10503', 3, 'Delivery', N'Salt Lake City, UT',  N'Wasatch Supply Group',      N'1775 S 4800 W',             '801-555-0129', DATEADD(HOUR, 44, @day), DATEADD(HOUR, 48, @day), N'PO-330918', NULL, NULL, NULL),

    ('L-10504', 1, 'Pickup',   N'Las Vegas, NV',       N'Mojave Cold Chain',         N'4600 W Sunset Rd',          '702-555-0132', DATEADD(HOUR, 31, @day), DATEADD(HOUR, 35, @day), N'PU-880144', N'reefer 36F', NULL, NULL),
    ('L-10504', 2, 'Delivery', N'Flagstaff, AZ',       N'High Country Grocers',      N'2200 E Butler Ave',         '928-555-0155', DATEADD(HOUR, 41, @day), DATEADD(HOUR, 45, @day), N'PO-330919', NULL, NULL, NULL),

    ('L-10505', 1, 'Pickup',   N'Barstow, CA',         N'Mojave Aggregates',         N'2800 Lenwood Rd',           '760-555-0188', DATEADD(HOUR, 54, @day), DATEADD(HOUR, 58, @day), N'PU-880145', N'tarped, 4 straps minimum', NULL, NULL),
    ('L-10505', 2, 'Delivery', N'Las Vegas, NV',       N'Valley Steel Service',      N'4055 W Cheyenne Ave',       '702-555-0173', DATEADD(HOUR, 64, @day), DATEADD(HOUR, 68, @day), N'PO-330920', NULL, NULL, NULL);

    PRINT 'INSERTED 11 stops for L-10501..L-10505';
END
ELSE
    PRINT 'Southwest stops already present';
GO

------------------------------------------------------------------------------
-- What went in, and what still has to happen outside this file.
------------------------------------------------------------------------------
SELECT l.id, l.status, l.origin, l.destination, l.driver_code, l.unit_no,
       l.customer_id, l.customer_name,
       (SELECT COUNT(*) FROM dbo.LoadStops s WHERE s.load_id = l.id) AS stops
FROM dbo.Loads AS l
WHERE l.id LIKE 'L-105%'
ORDER BY l.id;
GO

PRINT '';
PRINT 'NEXT: create the GeoTab zones for these cities, or the map has no';
PRINT 'coordinates for them and the ETA will refuse with "no zone for ...":';
PRINT '    .\geotab-add-zones.ps1 -Database demo_millstream -FromLanes -WhatIf';
PRINT '    .\geotab-add-zones.ps1 -Database demo_millstream -FromLanes';
GO
