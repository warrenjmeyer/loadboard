-- documents_01_ddl.sql
-- The paper on a load: the bill of lading, the signed proof of delivery,
-- the lumper receipt, the rate confirmation.
--
-- Until now these lived on the driver's phone and in a dispatcher's inbox.
-- dbo.LoadDocuments is the index: one row per file, naming the load it
-- belongs to, the stop if it belongs to one (a POD is signed at a dock),
-- what kind of paper it is, and where the bytes are.
--
-- THE BYTES ARE NOT HERE. They are in Azure Blob Storage, in a private
-- container, under blob_name; api/src/storage.js reads and writes them and
-- hands the browser a short-lived signed URL to view one. A database row
-- holding a 4 MB scan is the wrong shape for a database, and the blob
-- store is a few dollars a year for what a carrier this size produces.
--
-- stop_id has NO cascade action, on purpose. Loads already cascades to
-- both LoadStops and LoadDocuments, so a SET NULL from LoadStops would be
-- the second path to LoadDocuments and SQL Server refuses to create it.
-- stops.js clears stop_id itself before it deletes a stop that has paper
-- attached; the document stays, on the load, unlabelled by stop.
--
-- Run as sqlmillstream (db_owner). Requires stops_01_ddl.sql. Safe to
-- re-run. No seed: there is nothing to seed a scan from.

SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.LoadDocuments', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.LoadDocuments (
        document_id   INT IDENTITY(1,1) NOT NULL,
        load_id       VARCHAR(20)   NOT NULL,
        stop_id       INT           NULL,
        doc_type      VARCHAR(10)   NOT NULL,   -- BOL, POD, RECEIPT, RATECON, OTHER
        file_name     NVARCHAR(200) NOT NULL,   -- as uploaded, for the link text
        content_type  VARCHAR(100)  NOT NULL,   -- what the browser said it was
        size_bytes    INT           NOT NULL,
        blob_name     VARCHAR(300)  NOT NULL,   -- where it is in the container
        notes         NVARCHAR(400) NULL,
        uploaded_utc  DATETIME2(0)  NOT NULL CONSTRAINT DF_Documents_uploaded DEFAULT SYSUTCDATETIME(),
        uploaded_by   NVARCHAR(256) NULL,

        CONSTRAINT PK_LoadDocuments PRIMARY KEY (document_id),
        CONSTRAINT UQ_LoadDocuments_blob UNIQUE (blob_name),
        CONSTRAINT FK_Documents_load FOREIGN KEY (load_id) REFERENCES dbo.Loads (id) ON DELETE CASCADE,
        CONSTRAINT FK_Documents_stop FOREIGN KEY (stop_id) REFERENCES dbo.LoadStops (stop_id),
        CONSTRAINT CK_Documents_type CHECK (doc_type IN ('BOL', 'POD', 'RECEIPT', 'RATECON', 'OTHER')),
        CONSTRAINT CK_Documents_size CHECK (size_bytes > 0)
    );
    CREATE INDEX IX_Documents_load ON dbo.LoadDocuments (load_id, doc_type);
    CREATE INDEX IX_Documents_stop ON dbo.LoadDocuments (stop_id) WHERE stop_id IS NOT NULL;
    PRINT 'CREATED dbo.LoadDocuments';
END
ELSE
    PRINT 'dbo.LoadDocuments already exists';
GO

SELECT 'LoadDocuments' AS item, (SELECT COUNT(*) FROM dbo.LoadDocuments) AS present;
GO
