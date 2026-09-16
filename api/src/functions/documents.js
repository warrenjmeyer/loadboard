const { app } = require('@azure/functions')
const { getPool, sql } = require('../db')
const identity = require('../identity')
const storage = require('../storage')
const rules = require('../documentRules')

// ---------------------------------------------------------------------------
// The paper on a load.
//
//   GET    /api/loads/{id}/documents     any real role: what is attached,
//                                        with a fresh view link for each
//   POST   /api/loads/{id}/documents     multipart form: file, docType,
//                                        stopId?, notes? -- dispatch, or
//                                        the driver on the load
//   GET    /api/documents/{documentId}   302 to a signed URL good for ten
//                                        minutes (any real role)
//   DELETE /api/documents/{documentId}   dispatch, or the uploader while
//                                        the load is not yet invoiced
//
// The browser never talks to the storage account with a credential. It
// uploads HERE, and this streams the bytes on; to view a file it follows
// a redirect to a URL that opens that one blob for a few minutes. The
// container stays private, and a link pasted into a chat is dead by the
// time anyone else clicks it.
//
// Upload first, then the row, so a row never points at bytes that are not
// there. If the INSERT fails the blob is deleted again. The other way
// round would leave a row with no file, which is the worse orphan.
//
// When STORAGE_CONNECTION is unset every route answers 503 configured:
// false, and the page shows a line instead of the section -- the same
// shape as the GeoTab routes.
// ---------------------------------------------------------------------------

const LOAD_ID = /^[A-Za-z0-9._-]{1,20}$/
const isoDateTime = (v) => (v ? v.toISOString().slice(0, 19) : null)

function badRequest(errors) {
  return { status: 400, jsonBody: { error: Array.isArray(errors) ? errors.join(' ') : errors } }
}

function notFound() {
  return { status: 404, jsonBody: { error: 'That load is not on the board.' } }
}

function notConfigured() {
  return {
    status: 503,
    jsonBody: { error: 'Document storage is not connected on this server. Set STORAGE_CONNECTION in the app settings.', configured: false },
    headers: { 'Cache-Control': 'no-store' },
  }
}

function row(r) {
  return {
    documentId: r.document_id,
    loadId: r.load_id,
    stopId: r.stop_id,
    stopSeq: r.stop_seq === null || r.stop_seq === undefined ? null : Number(r.stop_seq),
    stopPlace: r.stop_place || null,
    docType: r.doc_type,
    docTypeLabel: rules.TYPES[r.doc_type] || r.doc_type,
    fileName: r.file_name,
    contentType: r.content_type,
    sizeBytes: Number(r.size_bytes),
    notes: r.notes,
    uploadedUtc: isoDateTime(r.uploaded_utc),
    uploadedBy: r.uploaded_by,
    // Where to open it. Minted per request and good for ten minutes.
    viewUrl: storage.configured() ? storage.viewUrl(r.blob_name, r.file_name) : null,
  }
}

const SELECT = `
  SELECT d.document_id, d.load_id, d.stop_id, s.seq AS stop_seq, s.place AS stop_place,
         d.doc_type, d.file_name, d.content_type, d.size_bytes, d.blob_name, d.notes, d.uploaded_utc, d.uploaded_by
  FROM dbo.LoadDocuments AS d
  LEFT JOIN dbo.LoadStops AS s ON s.stop_id = d.stop_id`

async function loadFor(pool, id) {
  const r = await pool.request().input('id', sql.VarChar(20), id).query(`
    SELECT l.load_number AS id, l.status, l.driver_code, inv.invoice_no
    FROM dbo.Loads AS l LEFT JOIN dbo.Invoices AS inv ON inv.invoice_id = l.invoice_id
    WHERE l.load_number = @id;
  `)
  const l = r.recordset[0]
  return l ? { id: l.id, status: l.status, driverCode: l.driver_code, invoiceNo: l.invoice_no || null } : null
}

async function gate(request) {
  const user = await identity.currentUser(request)
  if (!user) return { error: identity.unauthorized('Sign in to see documents.') }
  if (user.role === 'none') return { error: identity.forbidden('Your account is waiting for approval.') }
  return { user }
}

// ---------------------------------------------------------------------------
async function list(request) {
  const id = request.params.id
  if (!LOAD_ID.test(id)) return notFound()
  const g = await gate(request)
  if (g.error) return g.error
  if (!storage.configured()) return notConfigured()

  const pool = await getPool()
  const load = await loadFor(pool, id)
  if (!load) return notFound()
  const result = await pool.request().input('id', sql.VarChar(20), id)
    .query(`${SELECT} WHERE d.load_id = @id ORDER BY d.uploaded_utc, d.document_id;`)
  return {
    jsonBody: { loadId: id, canUpload: rules.canUpload(g.user, load), documents: result.recordset.map(row) },
    headers: { 'Cache-Control': 'no-store' },
  }
}

async function upload(request, context) {
  const id = request.params.id
  if (!LOAD_ID.test(id)) return notFound()
  const g = await gate(request)
  if (g.error) return g.error
  if (!storage.configured()) return notConfigured()

  let form
  try {
    form = await request.formData()
  } catch {
    return badRequest('Expected a multipart form with a file.')
  }
  const file = form.get('file')
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
    return badRequest('Attach a file.')
  }
  const { errors, doc } = rules.validateUpload({
    docType: form.get('docType'),
    stopId: form.get('stopId'),
    notes: form.get('notes'),
    fileName: file.name,
    contentType: file.type,
    size: file.size,
  })
  if (errors.length) return badRequest(errors)

  const pool = await getPool()
  const load = await loadFor(pool, id)
  if (!load) return notFound()
  if (!rules.canUpload(g.user, load)) {
    return identity.forbidden(load.status === 'Cancelled'
      ? 'A cancelled load cannot take documents.'
      : 'Only dispatch, or the driver on this load, can attach documents to it.')
  }
  if (doc.stopId) {
    const s = await pool.request().input('sid', sql.Int, doc.stopId).input('id', sql.VarChar(20), id)
      .query('SELECT 1 AS ok FROM dbo.LoadStops WHERE stop_id = @sid AND load_id = @id;')
    if (!s.recordset[0]) return badRequest('That stop is not on this load.')
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  if (buffer.length !== doc.sizeBytes) doc.sizeBytes = buffer.length
  const blobName = rules.blobNameFor(id, doc.contentType)
  await storage.upload(blobName, buffer, doc.contentType)

  let documentId
  try {
    const inserted = await pool.request()
      .input('id', sql.VarChar(20), id)
      .input('stopId', sql.Int, doc.stopId)
      .input('type', sql.VarChar(10), doc.docType)
      .input('fileName', sql.NVarChar(200), doc.fileName)
      .input('contentType', sql.VarChar(100), doc.contentType)
      .input('size', sql.Int, doc.sizeBytes)
      .input('blob', sql.VarChar(300), blobName)
      .input('notes', sql.NVarChar(400), doc.notes)
      .input('by', sql.NVarChar(256), g.user.email)
      .input('detail', sql.NVarChar(400), `Attached ${rules.TYPES[doc.docType].toLowerCase()} ${doc.fileName}`)
      .query(`
        INSERT INTO dbo.LoadDocuments (load_id, stop_id, doc_type, file_name, content_type, size_bytes, blob_name, notes, uploaded_by)
        OUTPUT inserted.document_id
        VALUES (@id, @stopId, @type, @fileName, @contentType, @size, @blob, @notes, @by);
        INSERT INTO dbo.LoadEvents (load_id, actor, event_type, detail) VALUES (@id, @by, 'Edited', @detail);
      `)
    documentId = inserted.recordset[0].document_id
  } catch (err) {
    await storage.remove(blobName).catch(() => {})
    throw err
  }
  context.log(`Document ${documentId} (${doc.docType}, ${doc.sizeBytes} bytes) on ${id} by ${g.user.email}`)

  const saved = await pool.request().input('d', sql.Int, documentId).query(`${SELECT} WHERE d.document_id = @d;`)
  return { status: 201, jsonBody: row(saved.recordset[0]), headers: { 'Cache-Control': 'no-store' } }
}

async function view(request) {
  const documentId = Number(request.params.documentId)
  if (!Number.isInteger(documentId) || documentId <= 0) return { status: 404, jsonBody: { error: 'No such document.' } }
  const g = await gate(request)
  if (g.error) return g.error
  if (!storage.configured()) return notConfigured()

  const pool = await getPool()
  const found = await pool.request().input('d', sql.Int, documentId).query(`${SELECT} WHERE d.document_id = @d;`)
  const r = found.recordset[0]
  if (!r) return { status: 404, jsonBody: { error: 'No such document.' } }
  return {
    status: 302,
    headers: { Location: storage.viewUrl(r.blob_name, r.file_name, { minutes: 10 }), 'Cache-Control': 'no-store' },
  }
}

async function remove(request, context) {
  const documentId = Number(request.params.documentId)
  if (!Number.isInteger(documentId) || documentId <= 0) return { status: 404, jsonBody: { error: 'No such document.' } }
  const g = await gate(request)
  if (g.error) return g.error
  if (!storage.configured()) return notConfigured()

  const pool = await getPool()
  const found = await pool.request().input('d', sql.Int, documentId).query(`${SELECT} WHERE d.document_id = @d;`)
  const r = found.recordset[0]
  if (!r) return { status: 404, jsonBody: { error: 'No such document.' } }
  const load = await loadFor(pool, r.load_id)
  if (!rules.canRemove(g.user, { uploadedBy: r.uploaded_by }, load)) {
    return identity.forbidden(load && load.invoiceNo
      ? 'That load has been invoiced; only dispatch can remove its documents now.'
      : 'Only dispatch, or whoever attached it, can remove a document.')
  }

  // Row first, then the bytes. A blob nobody can find is untidy; a row
  // pointing at nothing is a broken link on the page.
  await pool.request()
    .input('d', sql.Int, documentId)
    .input('id', sql.VarChar(20), r.load_id)
    .input('by', sql.NVarChar(256), g.user.email)
    .input('detail', sql.NVarChar(400), `Removed ${rules.TYPES[r.doc_type].toLowerCase()} ${r.file_name}`)
    .query(`
      DELETE FROM dbo.LoadDocuments WHERE document_id = @d;
      INSERT INTO dbo.LoadEvents (load_id, actor, event_type, detail) VALUES (@id, @by, 'Edited', @detail);
    `)
  await storage.remove(r.blob_name).catch((err) => context.error(`Blob ${r.blob_name} not removed:`, err.message))
  context.log(`Document ${documentId} on ${r.load_id} removed by ${g.user.email}`)
  return { status: 204 }
}

// ---------------------------------------------------------------------------
function wrap(label, handler) {
  return async (request, context) => {
    try {
      return await handler(request, context)
    } catch (err) {
      if (err.number === 547) {
        context.error(`${label} refused by constraint:`, err.message)
        return badRequest('The database refused that change.')
      }
      if (err.name === 'RestError' || err.statusCode) {
        context.error(`${label} refused by storage:`, err.message)
        storage.forget()
        return { status: 502, jsonBody: { error: 'Document storage refused the request. Check the storage connection setting.', configured: true } }
      }
      context.error(`${label} failed:`, err)
      return { status: 500, jsonBody: { error: 'Could not load data.' } }
    }
  }
}

app.http('loadDocuments', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'loads/{id}/documents',
  handler: wrap('/api/loads/{id}/documents', (request, context) =>
    request.method === 'POST' ? upload(request, context) : list(request)),
})

app.http('document', {
  methods: ['GET', 'DELETE'],
  authLevel: 'anonymous',
  route: 'documents/{documentId}',
  handler: wrap('/api/documents/{documentId}', (request, context) =>
    request.method === 'DELETE' ? remove(request, context) : view(request)),
})
