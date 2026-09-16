------------------------------------------------------------------------------
-- stops_03_second_consignee.sql -- one load that delivers to two customers.
--
-- WHY THIS EXISTS. PR #13 put each stop's own reference number on the printed
-- invoice: a dock line under every load showing the PO that dock will look
-- for, because a consignee's accounts-payable clerk searches for THEIR
-- number and not the carrier's order number. It works, and on this data it
-- has never once been worth looking at -- because no load in the seed
-- delivers to two consignees. Every load is a pickup and a delivery, so the
-- stop's number and the load's number are the same fact written twice.
--
-- The case the feature exists for is one load, two receivers, two POs,
-- neither of them the load's own. This adds exactly that, to one delivered
-- load that is already on a paid invoice, so it shows up on a document that
-- can be printed today rather than after somebody runs a whole pay cycle.
--
-- IT CHOOSES THE LOAD ITSELF rather than naming one. The seed's ids differ
-- between anyone's database and the point is the shape of the data, not a
-- particular row: it takes a delivered, invoiced, two-stop Midwest load and
-- splits its delivery into two. It prints which one it picked.
--
-- Re-running is safe: it does nothing once the load it picked has 3 stops.
------------------------------------------------------------------------------

SET NOCOUNT ON;
GO

DECLARE @load VARCHAR(20);

-- A delivered load, on an invoice, with exactly two stops, whose destination
-- is not one of the Southwest lanes -- this is about the Midwest freight the
-- invoices were generated from. Ordered by id so the choice is stable: a
-- re-run on a fresh database picks the same load as the first run did.
SELECT TOP 1 @load = l.id
FROM dbo.Loads AS l
WHERE l.status = N'Delivered'
  AND l.invoice_id IS NOT NULL
  AND l.id NOT LIKE 'L-105%'
  AND (SELECT COUNT(*) FROM dbo.LoadStops s WHERE s.load_id = l.id) = 2
ORDER BY l.id;

IF @load IS NULL
BEGIN
    PRINT 'No delivered, invoiced, two-stop load found -- nothing to do.';
END
ELSE IF (SELECT COUNT(*) FROM dbo.LoadStops WHERE load_id = @load) >= 3
BEGIN
    PRINT 'Load ' + @load + ' already has a second consignee.';
END
ELSE
BEGIN
    DECLARE @dest NVARCHAR(100) = (SELECT destination FROM dbo.Loads WHERE id = @load);
    DECLARE @lastSeq SMALLINT = (SELECT MAX(seq) FROM dbo.LoadStops WHERE load_id = @load);
    DECLARE @arrived DATETIME2(0) = (SELECT arrived_utc FROM dbo.LoadStops WHERE load_id = @load AND seq = @lastSeq);
    DECLARE @departed DATETIME2(0) = (SELECT departed_utc FROM dbo.LoadStops WHERE load_id = @load AND seq = @lastSeq);
    DECLARE @windowStart DATETIME2(0) = (SELECT window_start FROM dbo.LoadStops WHERE load_id = @load AND seq = @lastSeq);
    DECLARE @windowEnd DATETIME2(0) = (SELECT window_end FROM dbo.LoadStops WHERE load_id = @load AND seq = @lastSeq);

    -- THE EXISTING DELIVERY MOVES DOWN FIRST. seq is UNIQUE per load
    -- (UQ_LoadStops_seq), so inserting the new stop at the number the old one
    -- still holds would be rejected -- and the fix is the order of these two
    -- statements, not a clever insert.
    UPDATE dbo.LoadStops
       SET seq = @lastSeq + 1
     WHERE load_id = @load AND seq = @lastSeq;

    -- Then the new drop takes its place. Two receivers in one city is the
    -- ordinary version of this -- a drop and a final -- and it keeps the
    -- load's origin and destination summary columns true, since the API
    -- rewrites those from the first and last stop.
    INSERT INTO dbo.LoadStops
        (load_id, seq, stop_type, place, name, address, phone, window_start, window_end, reference_no, notes, arrived_utc, departed_utc)
    VALUES
        (@load, @lastSeq, 'Delivery', @dest,
         N'Lakeside Grocery Warehouse', N'2200 Frontage Rd', '312-555-0164',
         @windowStart, @windowEnd,
         -- A purchase order of the RECEIVER's own. Nothing about it matches
         -- the load's reference number, which is the entire point: this is
         -- the number that consignee's AP will search for, and before PR #13
         -- the invoice had nowhere to print it.
         N'PO-LK-48802',
         N'partial -- 9 pallets here, balance to the final stop',
         @arrived, @departed);

    PRINT 'SPLIT the delivery on ' + @load + ' into two consignees';
END
GO

------------------------------------------------------------------------------
-- What it did, and where to look at it.
------------------------------------------------------------------------------
SELECT l.id, l.status, l.reference_no AS load_ref, i.invoice_no,
       s.seq, s.stop_type, s.place, s.name, s.reference_no AS stop_ref
FROM dbo.Loads AS l
JOIN dbo.LoadStops AS s ON s.load_id = l.id
LEFT JOIN dbo.Invoices AS i ON i.invoice_id = l.invoice_id
WHERE l.id IN (
    SELECT TOP 1 l2.id
    FROM dbo.Loads AS l2
    WHERE l2.status = N'Delivered' AND l2.invoice_id IS NOT NULL AND l2.id NOT LIKE 'L-105%'
      AND (SELECT COUNT(*) FROM dbo.LoadStops s2 WHERE s2.load_id = l2.id) = 3
    ORDER BY l2.id
)
ORDER BY s.seq;
GO

PRINT '';
PRINT 'Open that invoice at /invoices/<invoice_no> and print it. The load line';
PRINT 'should now carry TWO dock lines, each with its own PO -- neither of them';
PRINT 'the load reference above them. That is what PR #13 was built for.';
GO
