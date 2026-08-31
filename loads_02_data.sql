-- loads_02_data.sql
-- The original 8 seed rows for dbo.Loads. Needs only INSERT/UPDATE rights on
-- an existing table -- no DDL permission required.
--
-- MERGE, not INSERT, so re-running this is safe: it updates rows that exist
-- and adds the ones that do not.
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
    ('L-10419', N'Iowa City, IA',    N'Milwaukee, WI',    232,  815.00, N'Dry Van', N'Available')
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
