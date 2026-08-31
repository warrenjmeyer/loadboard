-- loads_02_data.sql
-- Seed rows for dbo.Loads -- the load board itself, not the settlements.
-- Needs only INSERT/UPDATE rights on an existing table; no DDL permission.
--
-- MERGE, not INSERT, so re-running this is safe: it updates rows that exist
-- and adds the ones that do not.
--
-- Rate per mile falls as the haul lengthens, because the fixed cost of loading
-- is spread over fewer miles on a short run. That is why the 92-mile Chicago -
-- Milwaukee pays $4.18/mi and the 950-mile Minneapolis - Dallas pays $2.31. A
-- flat rate per mile across every length is the tell of invented freight data.
--
-- If your table lives somewhere other than dbo.Loads, change :target below
-- (both occurrences) to match, e.g. staging.Loads or Millstream.dbo.Loads.

MERGE dbo.Loads AS target
USING (VALUES
    ('L-10412', N'Dubuque, IA',      N'Chicago, IL',      182,  585.00, N'Reefer',  N'Available'),
    ('L-10413', N'Cedar Rapids, IA', N'Kansas City, MO',  322,  940.00, N'Dry Van', N'Covered'),
    ('L-10414', N'Davenport, IA',    N'Indianapolis, IN', 356, 1075.00, N'Reefer',  N'Available'),
    ('L-10415', N'Des Moines, IA',   N'Denver, CO',       670, 1810.00, N'Flatbed', N'Available'),
    ('L-10416', N'Waterloo, IA',     N'Minneapolis, MN',  246,  700.00, N'Dry Van', N'Delivered'),
    ('L-10417', N'Dubuque, IA',      N'St. Louis, MO',    340, 1120.00, N'Reefer',  N'Available'),
    ('L-10418', N'Sioux City, IA',   N'Omaha, NE',         95,  380.00, N'Flatbed', N'Covered'),
    ('L-10419', N'Iowa City, IA',    N'Milwaukee, WI',    232,  815.00, N'Dry Van', N'Available'),
    ('L-10420', N'Dallas, TX',        N'Kansas City, MO',   552, 1390.00, N'Flatbed', N'Delivered'),
    ('L-10421', N'Minneapolis, MN',   N'Dubuque, IA',       285,  865.00, N'Flatbed', N'Available'),
    ('L-10422', N'Iowa City, IA',     N'Kansas City, MO',   285,  980.00, N'Reefer',  N'Available'),
    ('L-10423', N'Omaha, NE',         N'Des Moines, IA',    135,  535.00, N'Reefer',  N'Delivered'),
    ('L-10424', N'Des Moines, IA',    N'Chicago, IL',       333, 1005.00, N'Reefer',  N'Available'),
    ('L-10425', N'Omaha, NE',         N'Denver, CO',        537, 1430.00, N'Dry Van', N'Covered'),
    ('L-10426', N'Chicago, IL',       N'Milwaukee, WI',      92,  385.00, N'Reefer',  N'Delivered'),
    ('L-10427', N'Kansas City, MO',   N'Des Moines, IA',    195,  680.00, N'Dry Van', N'Available'),
    ('L-10428', N'Minneapolis, MN',   N'Dallas, TX',        950, 2195.00, N'Dry Van', N'Available'),
    ('L-10429', N'Des Moines, IA',    N'Nashville, TN',     700, 1605.00, N'Flatbed', N'Available'),
    ('L-10430', N'Davenport, IA',     N'St. Louis, MO',     260,  930.00, N'Reefer',  N'Delivered'),
    ('L-10431', N'Cedar Rapids, IA',  N'Dallas, TX',        800, 2070.00, N'Dry Van', N'Available'),
    ('L-10432', N'Chicago, IL',       N'Oklahoma City, OK', 800, 2095.00, N'Flatbed', N'Available'),
    ('L-10433', N'Chicago, IL',       N'Dubuque, IA',       182,  575.00, N'Dry Van', N'Available'),
    ('L-10434', N'Milwaukee, WI',     N'Oklahoma City, OK', 880, 2270.00, N'Flatbed', N'Available'),
    ('L-10435', N'Sioux City, IA',    N'Nashville, TN',     830, 2170.00, N'Reefer',  N'Available'),
    ('L-10436', N'Oklahoma City, OK', N'Dallas, TX',        206,  715.00, N'Flatbed', N'Covered'),
    ('L-10437', N'Denver, CO',        N'Kansas City, MO',   605, 1730.00, N'Reefer',  N'Available'),
    ('L-10438', N'St. Louis, MO',     N'Memphis, TN',       285,  915.00, N'Flatbed', N'Available'),
    ('L-10439', N'Denver, CO',        N'Minneapolis, MN',   915, 2270.00, N'Flatbed', N'Covered'),
    ('L-10440', N'Cedar Rapids, IA',  N'Minneapolis, MN',   280,  910.00, N'Dry Van', N'Available'),
    ('L-10441', N'Memphis, TN',       N'Nashville, TN',     212,  670.00, N'Dry Van', N'Covered'),
    ('L-10442', N'St. Louis, MO',     N'Denver, CO',        855, 1960.00, N'Reefer',  N'Available'),
    ('L-10443', N'Indianapolis, IN',  N'Chicago, IL',       184,  550.00, N'Dry Van', N'Available')
) AS source (id, origin, destination, miles, rate, equipment, status)
ON target.id = source.id
WHEN MATCHED THEN
    UPDATE SET
        origin      = source.origin,
        destination = source.destination,
        miles       = source.miles,
        rate        = source.rate,
        equipment   = source.equipment,
        status      = source.status
WHEN NOT MATCHED THEN
    INSERT (id, origin, destination, miles, rate, equipment, status)
    VALUES (source.id, source.origin, source.destination, source.miles,
            source.rate, source.equipment, source.status);
GO

SELECT * FROM dbo.Loads ORDER BY id;
GO
