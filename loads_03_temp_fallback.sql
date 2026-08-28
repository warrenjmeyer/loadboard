-- loads_03_temp_fallback.sql
-- No permissions anywhere? Temp tables live in tempdb and every login can
-- create them. Lets you query/join the data right now; it vanishes when your
-- session ends, so this is for exploration, not persistence.

DROP TABLE IF EXISTS #Loads;

CREATE TABLE #Loads (
    id          VARCHAR(20)   NOT NULL PRIMARY KEY,
    origin      NVARCHAR(100) NOT NULL,
    destination NVARCHAR(100) NOT NULL,
    miles       INT           NOT NULL,
    rate        DECIMAL(10,2) NOT NULL,
    equipment   NVARCHAR(50)  NOT NULL,
    status      NVARCHAR(20)  NOT NULL
);

INSERT INTO #Loads (id, origin, destination, miles, rate, equipment, status) VALUES
    ('L-10412', N'Dubuque, IA',      N'Chicago, IL',      182,  585.00, N'Reefer',  N'Available'),
    ('L-10413', N'Cedar Rapids, IA', N'Kansas City, MO',  322,  940.00, N'Dry Van', N'Covered'),
    ('L-10414', N'Davenport, IA',    N'Indianapolis, IN', 356, 1075.00, N'Reefer',  N'Available'),
    ('L-10415', N'Des Moines, IA',   N'Denver, CO',       670, 1810.00, N'Flatbed', N'Available'),
    ('L-10416', N'Waterloo, IA',     N'Minneapolis, MN',  246,  700.00, N'Dry Van', N'Delivered'),
    ('L-10417', N'Dubuque, IA',      N'St. Louis, MO',    340, 1120.00, N'Reefer',  N'Available'),
    ('L-10418', N'Sioux City, IA',   N'Omaha, NE',         95,  380.00, N'Flatbed', N'Covered'),
    ('L-10419', N'Iowa City, IA',    N'Milwaukee, WI',    232,  815.00, N'Dry Van', N'Available');

SELECT * FROM #Loads ORDER BY id;
