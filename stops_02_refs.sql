-- stops_02_refs.sql
-- The numbers a customer's accounts payable department actually searches for.
--
-- stops_01_ddl.sql seeded every stop's place, dock name, address and window
-- from the six summary columns on dbo.Loads, and left reference_no NULL --
-- there was nothing on Loads to copy one from, because dbo.Loads.reference_no
-- was never seeded either. The invoice now prints a Ref # against the load
-- and against every dock under it, so today that column is blank on 225
-- loads and 450 stops: a finished feature that looks broken, on demo data
-- that looks like a schema rather than like freight.
--
-- This fills in what dispatch would have typed when the load was booked:
--
--   dbo.Loads.reference_no     the customer's order number -- three letters
--                              of their name and six digits, ORD- where the
--                              load has no customer record
--   LoadStops, Pickup          PU-nnnnnn, the shipper's pickup number
--   LoadStops, Delivery        PO-nnnnnn, the consignee's purchase order
--
-- Three different numbers on one load, on purpose. That is the case the
-- invoice was changed to handle: the load carries the customer's order
-- number, each dock carries its own, and a load delivering to two consignees
-- has two POs neither of which is the one on the load. Seeding all three the
-- same would hide the whole point.
--
-- THE DIGITS ARE DERIVED, NOT RANDOM: a stable arithmetic hash of the load
-- number and the stop's sequence. Re-running produces the same numbers, so a
-- load whose invoice was printed last week still shows that reference when
-- the invoice is reprinted. NEWID() could not promise that, and a reference
-- that changes between two copies of one invoice is a dispute, not a
-- cosmetic difference.
--
-- Only NULLs are filled, so anything typed by hand in Edit stops survives
-- and a second run changes nothing.
--
-- Run as sqlmillstream (db_owner). Requires stops_01_ddl.sql. Safe to re-run.

SET NOCOUNT ON;
GO

-- ---------------------------------------------------------------------------
-- The load's own reference: the customer's order number.
-- ---------------------------------------------------------------------------
IF OBJECT_ID(N'dbo.Loads', N'U') IS NOT NULL
BEGIN
    UPDATE l
       SET l.reference_no =
             ISNULL(NULLIF(UPPER(LEFT(REPLACE(c.name, N' ', N''), 3)), N''), N'ORD')
             + N'-'
             + CAST(100000 + (ABS(ISNULL(TRY_CAST(SUBSTRING(l.id, 3, 18) AS BIGINT),
                                         CAST(ABS(CHECKSUM(l.id)) AS BIGINT)) * 104729) % 900000) AS varchar(10))
      FROM dbo.Loads AS l
      LEFT JOIN dbo.Customers AS c ON c.customer_id = l.customer_id
     WHERE l.reference_no IS NULL;
    PRINT CAST(@@ROWCOUNT AS varchar(10)) + ' loads given the customer''s order number';
END
ELSE
    PRINT 'dbo.Loads does not exist -- run loads_01_ddl.sql first';
GO

-- ---------------------------------------------------------------------------
-- Every dock's own number. A pickup number is the shipper's; a purchase
-- order is the consignee's. The seq is in the hash so two deliveries on one
-- load do not share a PO -- two consignees raise two orders. It is in there
-- SQUARED as well, because a hash linear in seq puts the stops of a load a
-- fixed distance apart (…530, …143, …756) and a reader notices a counter
-- dressed up as a purchase order.
-- ---------------------------------------------------------------------------
IF OBJECT_ID(N'dbo.LoadStops', N'U') IS NOT NULL
BEGIN
    UPDATE s
       SET s.reference_no =
             CASE s.stop_type WHEN 'Pickup' THEN N'PU-' ELSE N'PO-' END
             + CAST(100000 + (ABS(ISNULL(TRY_CAST(SUBSTRING(s.load_id, 3, 18) AS BIGINT),
                                         CAST(ABS(CHECKSUM(s.load_id)) AS BIGINT)) * 7919
                                  + CAST(s.seq AS BIGINT) * 613
                                  + CAST(s.seq AS BIGINT) * CAST(s.seq AS BIGINT) * 90001) % 900000) AS varchar(10))
      FROM dbo.LoadStops AS s
     WHERE s.reference_no IS NULL;
    PRINT CAST(@@ROWCOUNT AS varchar(10)) + ' stops given their own reference number';
END
ELSE
    PRINT 'dbo.LoadStops does not exist -- run stops_01_ddl.sql first';
GO

-- ---------------------------------------------------------------------------
-- What the invoice will now print. "Loads whose stops all differ from the
-- load" is the number that matters: it is the case the Ref # column exists
-- for, and if it were zero the change would be invisible.
-- ---------------------------------------------------------------------------
SELECT 'Loads with a reference' AS item,
       (SELECT COUNT(*) FROM dbo.Loads WHERE reference_no IS NOT NULL) AS present,
       (SELECT COUNT(*) FROM dbo.Loads) AS total
UNION ALL
SELECT 'Stops with a reference',
       (SELECT COUNT(*) FROM dbo.LoadStops WHERE reference_no IS NOT NULL),
       (SELECT COUNT(*) FROM dbo.LoadStops)
UNION ALL
SELECT 'Loads where no stop repeats the load reference',
       (SELECT COUNT(*) FROM dbo.Loads AS l
         WHERE EXISTS (SELECT 1 FROM dbo.LoadStops AS s WHERE s.load_id = l.id)
           AND NOT EXISTS (SELECT 1 FROM dbo.LoadStops AS s
                            WHERE s.load_id = l.id AND s.reference_no = l.reference_no)),
       (SELECT COUNT(DISTINCT load_id) FROM dbo.LoadStops)
UNION ALL
SELECT 'Loads with more than one delivery PO',
       (SELECT COUNT(*) FROM (SELECT load_id FROM dbo.LoadStops
                               WHERE stop_type = 'Delivery'
                               GROUP BY load_id HAVING COUNT(DISTINCT reference_no) > 1) AS x),
       (SELECT COUNT(DISTINCT load_id) FROM dbo.LoadStops);
GO

-- A sample to read with your own eyes: one load, its order number, and the
-- number each of its docks carries.
SELECT TOP 8 s.load_id, l.reference_no AS load_ref, s.seq, s.stop_type, s.place, s.reference_no AS stop_ref
  FROM dbo.LoadStops AS s
  JOIN dbo.Loads AS l ON l.id = s.load_id
 WHERE s.load_id IN (SELECT TOP 3 load_id FROM dbo.LoadStops GROUP BY load_id ORDER BY COUNT(*) DESC, load_id)
 ORDER BY s.load_id, s.seq;
GO
