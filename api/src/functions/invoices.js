const { app } = require('@azure/functions')
const { getPool, sql } = require('../db')
const identity = require('../identity')
const rules = require('../invoiceRules')

// ---------------------------------------------------------------------------
// Invoices: delivered loads become what the customer owes.
//
//   GET   /api/invoicerun?invoiceDate=&through=     what a run would bill,
//                                                   customer by customer,
//                                                   nothing written (admin)
//   POST  /api/invoicerun { invoiceDate, through, customerIds? }
//                                                   create them, in one
//                                                   transaction (admin)
//   GET   /api/invoices?customer=&status=           the list, aged
//                                                   (dispatcher, admin)
//   GET   /api/invoices/{invoiceNo}                 one, with its lines
//   PATCH /api/invoices/{invoiceNo}                 { payment: { amount, paidDate } }
//                                                   or { status: 'Void' }
//                                                   (admin)
//
// Unbilled means Loads.invoice_id IS NULL for a load and
// LoadCharges.invoice_line_id IS NULL for a charge -- the same marker device
// the pay run uses, for the same reason: "has this been billed" needs one
// answer, and a NULL test is one answer.
//
// The run bills everything delivered ON OR BEFORE the through date that is
// still unbilled, plus every unbilled billable charge on a delivered load,
// straggler or not. A customer on Hold is billed like anyone else: the hold
// stops dispatch covering NEW freight; delivered freight is owed.
//
// Voiding clears the markers so the loads and charges are billable again,
// and keeps the number. Nothing here deletes.
// ---------------------------------------------------------------------------

const isoDate = (v) => (v ? v.toISOString().slice(0, 10) : null)
const today = () => new Date().toISOString().slice(0, 10)
const INVOICE_NO = /^INV-\d{6}-\d{4}$/

function badRequest(errors) {
  return { status: 400, jsonBody: { error: Array.isArray(errors) ? errors.join(' ') : errors } }
}

async function gate(request, { write = false } = {}) {
  const user = await identity.currentUser(request)
  if (!user) return { error: identity.unauthorized('Sign in to see invoices.') }
  if (user.role === 'none') return { error: identity.forbidden('Your account is waiting for approval.') }
  if (write) {
    if (!identity.can(user, 'runBilling')) return { error: identity.forbidden('Only an administrator can bill.') }
  } else if (!identity.can(user, 'viewInvoices')) {
    return { error: identity.forbidden('Only dispatch can see invoices.') }
  }
  return { user }
}

async function readBody(request) {
  try {
    return (await request.json()) || {}
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------
function invoiceRow(r, now) {
  const base = {
    invoiceId: r.invoice_id,
    invoiceNo: r.invoice_no,
    customerId: r.customer_id,
    customerName: r.customer_name,
    customerStatus: r.customer_status || null,
    invoiceDate: isoDate(r.invoice_date),
    dueDate: isoDate(r.due_date),
    termsDays: Number(r.terms_days),
    billToName: r.bill_to_name,
    billToAddress: r.bill_to_address,
    status: r.status,
    total: Number(r.total),
    paidAmount: Number(r.paid_amount),
    paidDate: isoDate(r.paid_date),
    notes: r.notes,
    loadCount: Number(r.load_count || 0),
    createdUtc: r.created_utc ? r.created_utc.toISOString() : null,
    createdBy: r.created_by,
  }
  return { ...base, ...rules.aging(base, now) }
}

const SELECT = `
  SELECT i.invoice_id, i.invoice_no, i.customer_id, c.name AS customer_name, c.status AS customer_status,
         i.invoice_date, i.due_date, i.terms_days, i.bill_to_name, i.bill_to_address,
         i.status, i.total, i.paid_amount, i.paid_date, i.notes, i.created_utc, i.created_by,
         (SELECT COUNT(*) FROM dbo.InvoiceLines AS x WHERE x.invoice_id = i.invoice_id AND x.line_type = 'LINEHAUL') AS load_count
  FROM dbo.Invoices AS i
  JOIN dbo.Customers AS c ON c.customer_id = i.customer_id`

// ---------------------------------------------------------------------------
// Gathering for a run: the unbilled loads, the unbilled billable charges,
// and every customer with an open balance. One round trip.
// ---------------------------------------------------------------------------
async function gather(req, { through }) {
  const result = await req.input('through', sql.VarChar(10), through).query(`
    SELECT l.id, l.customer_id, l.status, l.invoice_id, l.delivered_date, l.origin, l.destination, l.miles, l.rate, l.reference_no
    FROM dbo.Loads AS l
    WHERE l.status = N'Delivered' AND l.customer_id IS NOT NULL AND l.invoice_id IS NULL
      AND l.delivered_date <= CAST(@through AS DATE)
    ORDER BY l.customer_id, l.delivered_date, l.id;

    SELECT ch.charge_id, ch.load_id, l.customer_id, l.delivered_date, ch.bill_customer, ch.invoice_line_id,
           ch.code, ch.description, ch.amount, ch.bill_amount
    FROM dbo.LoadCharges AS ch
    JOIN dbo.Loads AS l ON l.id = ch.load_id
    WHERE ch.bill_customer = 1 AND ch.invoice_line_id IS NULL
      AND l.status = N'Delivered' AND l.customer_id IS NOT NULL
      AND l.delivered_date <= CAST(@through AS DATE)
    ORDER BY l.customer_id, ch.load_id, ch.charge_id;

    SELECT c.customer_id, c.name, c.status, c.payment_terms_days, c.credit_limit,
           c.address1, c.city, c.state, c.postal_code,
           ISNULL((SELECT SUM(i.total - i.paid_amount) FROM dbo.Invoices AS i
                    WHERE i.customer_id = c.customer_id AND i.status = 'Open'), 0) AS open_balance
    FROM dbo.Customers AS c;
  `)

  const loads = result.recordsets[0].map((r) => ({
    id: r.id, customerId: r.customer_id, status: r.status, invoiceId: r.invoice_id,
    deliveredDate: isoDate(r.delivered_date), origin: r.origin, destination: r.destination,
    miles: Number(r.miles), rate: Number(r.rate), referenceNo: r.reference_no,
  }))
  const charges = result.recordsets[1].map((r) => ({
    chargeId: r.charge_id, loadId: r.load_id, customerId: r.customer_id, deliveredDate: isoDate(r.delivered_date),
    billCustomer: Boolean(r.bill_customer), invoiceLineId: r.invoice_line_id,
    code: r.code, description: r.description, amount: Number(r.amount),
    billAmount: r.bill_amount === null ? null : Number(r.bill_amount),
  }))
  const customers = {}
  for (const c of result.recordsets[2]) {
    const cityLine = [c.city, [c.state, c.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    customers[c.customer_id] = {
      name: c.name, status: c.status, termsDays: Number(c.payment_terms_days),
      creditLimit: c.credit_limit === null ? null : Number(c.credit_limit),
      openBalance: Number(c.open_balance || 0),
      billToAddress: [c.address1, cityLine].filter(Boolean).join(', ') || null,
    }
  }
  return { loads, charges, customers }
}

function runFrom(source) {
  const d = rules.defaultRun(today())
  return { invoiceDate: source.invoiceDate || d.invoiceDate, through: source.through || d.through }
}

async function preview(request) {
  const g = await gate(request, { write: true })
  if (g.error) return g.error
  const q = request.query
  const run = runFrom({ invoiceDate: q.get('invoiceDate'), through: q.get('through') })
  const errors = rules.validateRun(run)
  if (errors.length) return badRequest(errors)

  const pool = await getPool()
  const gathered = await gather(pool.request(), run)
  const planned = rules.plan(gathered.loads, gathered.charges, gathered.customers, run)

  // Delivered loads with a typed customer name and no record cannot be
  // billed by a run. Counted so billing knows they exist.
  const unlinked = await pool.request().input('through', sql.VarChar(10), run.through).query(`
    SELECT COUNT(*) AS n FROM dbo.Loads
    WHERE status = N'Delivered' AND customer_id IS NULL AND invoice_id IS NULL AND delivered_date <= CAST(@through AS DATE);
  `)
  return { jsonBody: { ...planned, unlinkedLoads: Number(unlinked.recordset[0].n) }, headers: { 'Cache-Control': 'no-store' } }
}

async function generate(request, context) {
  const g = await gate(request, { write: true })
  if (g.error) return g.error
  const body = await readBody(request)
  if (!body) return badRequest('Expected a JSON body.')
  const run = runFrom(body)
  const errors = rules.validateRun(run)
  if (errors.length) return badRequest(errors)

  const only = Array.isArray(body.customerIds) && body.customerIds.length
    ? new Set(body.customerIds.map(Number))
    : null

  const pool = await getPool()
  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    const gathered = await gather(new sql.Request(tx), run)
    const planned = rules.plan(gathered.loads, gathered.charges, gathered.customers, run)
    const chosen = planned.invoices.filter((i) => !only || only.has(i.customerId))
    if (chosen.length === 0) {
      await tx.rollback()
      return badRequest('Nothing to bill: no unbilled delivered loads for the customers chosen.')
    }

    const seqRow = await new sql.Request(tx).input('d', sql.VarChar(10), run.invoiceDate).query(`
      SELECT MAX(TRY_CAST(RIGHT(invoice_no, 4) AS INT)) AS seq FROM dbo.Invoices WHERE invoice_date = CAST(@d AS DATE);
    `)
    let seq = Number(seqRow.recordset[0].seq || 0)

    const created = []
    for (const inv of chosen) {
      seq += 1
      const invoiceNo = rules.invoiceNo(run.invoiceDate, seq)
      const head = await new sql.Request(tx)
        .input('no', sql.VarChar(20), invoiceNo)
        .input('customerId', sql.Int, inv.customerId)
        .input('invoiceDate', sql.VarChar(10), run.invoiceDate)
        .input('dueDate', sql.VarChar(10), inv.dueDate)
        .input('terms', sql.SmallInt, inv.termsDays)
        .input('billToName', sql.NVarChar(100), inv.billToName)
        .input('billToAddress', sql.NVarChar(300), inv.billToAddress)
        .input('total', sql.Decimal(12, 2), inv.total)
        .input('by', sql.NVarChar(256), g.user.email)
        .query(`
          INSERT INTO dbo.Invoices (invoice_no, customer_id, invoice_date, due_date, terms_days, bill_to_name, bill_to_address, status, total, created_by)
          OUTPUT inserted.invoice_id
          VALUES (@no, @customerId, CAST(@invoiceDate AS DATE), CAST(@dueDate AS DATE), @terms, @billToName, @billToAddress, 'Open', @total, @by);
        `)
      const invoiceId = head.recordset[0].invoice_id

      for (const l of inv.loads) {
        await new sql.Request(tx)
          .input('inv', sql.Int, invoiceId)
          .input('loadId', sql.VarChar(20), l.id)
          .input('description', sql.NVarChar(200), l.lane)
          .input('amount', sql.Decimal(12, 2), l.amount)
          .input('actor', sql.NVarChar(256), g.user.email)
          .input('detail', sql.NVarChar(400), `Billed on ${invoiceNo}`)
          .query(`
            INSERT INTO dbo.InvoiceLines (invoice_id, load_id, line_type, description, amount)
            VALUES (@inv, @loadId, 'LINEHAUL', @description, @amount);
            -- The marker, guarded: a load billed by a racing run stays with
            -- the run that got there first, and the count says so.
            UPDATE dbo.Loads SET invoice_id = @inv WHERE id = @loadId AND invoice_id IS NULL;
            IF @@ROWCOUNT = 0 THROW 50409, 'already billed', 1;
            INSERT INTO dbo.LoadEvents (load_id, actor, event_type, detail) VALUES (@loadId, @actor, 'Edited', @detail);
          `)
      }
      for (const c of inv.charges) {
        await new sql.Request(tx)
          .input('inv', sql.Int, invoiceId)
          .input('loadId', sql.VarChar(20), c.loadId)
          .input('chargeId', sql.Int, c.chargeId)
          .input('description', sql.NVarChar(200), c.description)
          .input('amount', sql.Decimal(12, 2), c.amount)
          .query(`
            INSERT INTO dbo.InvoiceLines (invoice_id, load_id, line_type, description, amount)
            OUTPUT inserted.line_id
            VALUES (@inv, @loadId, 'CHARGE', @description, @amount);
          `)
          .then((r) => new sql.Request(tx)
            .input('line', sql.Int, r.recordset[0].line_id)
            .input('chargeId', sql.Int, c.chargeId)
            .query(`
              UPDATE dbo.LoadCharges SET invoice_line_id = @line WHERE charge_id = @chargeId AND invoice_line_id IS NULL;
              IF @@ROWCOUNT = 0 THROW 50409, 'already billed', 1;
            `))
      }
      created.push({
        invoiceNo, customerId: inv.customerId, customerName: inv.name, dueDate: inv.dueDate,
        loadCount: inv.loads.length, chargeCount: inv.charges.length, total: inv.total,
      })
    }

    await tx.commit()
    context.log(`Invoice run ${run.invoiceDate} by ${g.user.email}: ${created.length} invoices, ${created.reduce((t, c) => t + c.loadCount, 0)} loads`)
    return { status: 201, jsonBody: { ...run, created }, headers: { 'Cache-Control': 'no-store' } }
  } catch (err) {
    await tx.rollback().catch(() => {})
    throw err
  }
}

// ---------------------------------------------------------------------------
// The list and one invoice
// ---------------------------------------------------------------------------
async function list(request) {
  const g = await gate(request)
  if (g.error) return g.error
  const q = request.query
  const req = (await getPool()).request()
  const where = []
  const customer = Number(q.get('customer'))
  if (Number.isInteger(customer) && customer > 0) {
    req.input('customer', sql.Int, customer)
    where.push('i.customer_id = @customer')
  }
  const status = (q.get('status') || '').trim()
  if (['Open', 'Paid', 'Void'].includes(status)) {
    req.input('status', sql.VarChar(10), status)
    where.push('i.status = @status')
  }
  const result = await req.query(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY CASE i.status WHEN 'Open' THEN 0 WHEN 'Paid' THEN 1 ELSE 2 END, i.due_date, i.invoice_no;`)
  const now = today()
  const invoices = result.recordset.map((r) => invoiceRow(r, now))
  return {
    jsonBody: { asOf: now, invoices, aging: rules.agingSummary(invoices, now) },
    headers: { 'Cache-Control': 'no-store' },
  }
}

async function getOne(request) {
  const g = await gate(request)
  if (g.error) return g.error
  const no = String(request.params.invoiceNo || '').toUpperCase()
  if (!INVOICE_NO.test(no)) return { status: 404, jsonBody: { error: 'No such invoice.' } }

  const pool = await getPool()
  const result = await pool.request().input('no', sql.VarChar(20), no).query(`
    ${SELECT} WHERE i.invoice_no = @no;
    SELECT x.line_id, x.load_id, x.line_type, x.description, x.amount,
           l.delivered_date, l.reference_no, l.miles, l.driver_code
    FROM dbo.InvoiceLines AS x
    JOIN dbo.Invoices AS i ON i.invoice_id = x.invoice_id
    LEFT JOIN dbo.Loads AS l ON l.id = x.load_id
    WHERE i.invoice_no = @no
    ORDER BY l.delivered_date, x.load_id, CASE x.line_type WHEN 'LINEHAUL' THEN 0 ELSE 1 END, x.line_id;
    SELECT c.customer_id, c.name, c.contact_name, c.email, c.phone, c.mc_number, c.customer_type
    FROM dbo.Customers AS c JOIN dbo.Invoices AS i ON i.customer_id = c.customer_id WHERE i.invoice_no = @no;
    -- The paper behind the lines: a POD per load is what the customer's AP
    -- asks for before paying. Only when the documents table exists, so an
    -- invoice still opens on a database that has not run that migration.
    IF OBJECT_ID(N'dbo.LoadDocuments', N'U') IS NOT NULL
      SELECT d.document_id, d.load_id, d.doc_type, d.file_name
      FROM dbo.LoadDocuments AS d
      WHERE d.load_id IN (SELECT x.load_id FROM dbo.InvoiceLines AS x JOIN dbo.Invoices AS i ON i.invoice_id = x.invoice_id WHERE i.invoice_no = @no)
      ORDER BY d.load_id, d.document_id;
    ELSE
      SELECT TOP 0 NULL AS document_id, NULL AS load_id, NULL AS doc_type, NULL AS file_name;
  `)
  const head = result.recordsets[0][0]
  if (!head) return { status: 404, jsonBody: { error: 'No such invoice.' } }
  const c = result.recordsets[2][0]
  const documents = (result.recordsets[3] || []).map((d) => ({ documentId: d.document_id, loadId: d.load_id, docType: d.doc_type, fileName: d.file_name }))
  return {
    jsonBody: {
      ...invoiceRow(head, today()),
      customer: c ? { customerId: c.customer_id, name: c.name, contactName: c.contact_name, email: c.email, phone: c.phone, mcNumber: c.mc_number, customerType: c.customer_type } : null,
      lines: result.recordsets[1].map((x) => ({
        lineId: x.line_id, loadId: x.load_id, lineType: x.line_type, description: x.description, amount: Number(x.amount),
        deliveredDate: isoDate(x.delivered_date), referenceNo: x.reference_no,
        miles: x.miles === null ? null : Number(x.miles), driverCode: x.driver_code,
      })),
      documents,
    },
    headers: { 'Cache-Control': 'no-store' },
  }
}

// ---------------------------------------------------------------------------
// PATCH: a payment, or a void
// ---------------------------------------------------------------------------
async function patch(request, context) {
  const g = await gate(request, { write: true })
  if (g.error) return g.error
  const no = String(request.params.invoiceNo || '').toUpperCase()
  if (!INVOICE_NO.test(no)) return { status: 404, jsonBody: { error: 'No such invoice.' } }
  const body = await readBody(request)
  if (!body) return badRequest('Expected a JSON body.')

  const pool = await getPool()
  const found = await pool.request().input('no', sql.VarChar(20), no).query(`${SELECT} WHERE i.invoice_no = @no;`)
  const current = found.recordset[0]
  if (!current) return { status: 404, jsonBody: { error: 'No such invoice.' } }
  const inv = invoiceRow(current, today())

  if (body.status === 'Void') {
    if (inv.status === 'Void') return badRequest('That invoice is already void.')
    if (inv.paidAmount > 0) return badRequest('A partly paid invoice cannot be voided. Record the refund first, or leave it open.')
    const tx = new sql.Transaction(pool)
    await tx.begin()
    try {
      await new sql.Request(tx)
        .input('id', sql.Int, inv.invoiceId)
        .input('by', sql.NVarChar(256), g.user.email)
        .input('reason', sql.NVarChar(500), body.reason ? String(body.reason).slice(0, 500) : null)
        .input('detail', sql.NVarChar(400), `Invoice ${no} voided; billable again`)
        .query(`
          UPDATE dbo.Invoices SET status = 'Void', updated_utc = SYSUTCDATETIME(), updated_by = @by,
                 notes = CASE WHEN @reason IS NULL THEN notes ELSE CONCAT_WS(N' ', notes, N'Voided:', @reason) END
           WHERE invoice_id = @id;
          INSERT INTO dbo.LoadEvents (load_id, actor, event_type, detail)
          SELECT id, @by, 'Edited', @detail FROM dbo.Loads WHERE invoice_id = @id;
          UPDATE dbo.Loads SET invoice_id = NULL WHERE invoice_id = @id;
          UPDATE dbo.LoadCharges SET invoice_line_id = NULL
           WHERE invoice_line_id IN (SELECT line_id FROM dbo.InvoiceLines WHERE invoice_id = @id);
        `)
      await tx.commit()
    } catch (err) {
      await tx.rollback().catch(() => {})
      throw err
    }
    context.log(`Invoice ${no} voided by ${g.user.email}`)
  } else if (body.payment) {
    const { errors, fields } = rules.applyPayment(inv, body.payment)
    if (errors.length) return badRequest(errors)
    await pool.request()
      .input('id', sql.Int, inv.invoiceId)
      .input('paid', sql.Decimal(12, 2), fields.paidAmount)
      .input('paidDate', sql.VarChar(10), fields.paidDate)
      .input('status', sql.VarChar(10), fields.status)
      .input('by', sql.NVarChar(256), g.user.email)
      .query(`
        UPDATE dbo.Invoices SET paid_amount = @paid, paid_date = CAST(@paidDate AS DATE), status = @status,
               updated_utc = SYSUTCDATETIME(), updated_by = @by
         WHERE invoice_id = @id;
      `)
    context.log(`Invoice ${no}: payment ${body.payment.amount} recorded by ${g.user.email}, now ${fields.status}`)
  } else {
    return badRequest('Send { payment: { amount, paidDate } } or { status: "Void" }.')
  }

  const saved = await pool.request().input('no', sql.VarChar(20), no).query(`${SELECT} WHERE i.invoice_no = @no;`)
  return { jsonBody: invoiceRow(saved.recordset[0], today()), headers: { 'Cache-Control': 'no-store' } }
}

// ---------------------------------------------------------------------------
function wrap(label, handler) {
  return async (request, context) => {
    try {
      return await handler(request, context)
    } catch (err) {
      if (err.number === 50409 || err.number === 2627 || err.number === 2601) {
        return { status: 409, jsonBody: { error: 'Another run billed some of these loads first. Preview again.' } }
      }
      context.error(`${label} failed:`, err)
      return { status: 500, jsonBody: { error: 'Could not load data.' } }
    }
  }
}

app.http('invoicerun', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'invoicerun',
  handler: wrap('/api/invoicerun', (request, context) =>
    request.method === 'POST' ? generate(request, context) : preview(request)),
})

app.http('invoices', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'invoices',
  handler: wrap('/api/invoices', list),
})

app.http('invoice', {
  methods: ['GET', 'PATCH'],
  authLevel: 'anonymous',
  route: 'invoices/{invoiceNo}',
  handler: wrap('/api/invoices/{invoiceNo}', (request, context) =>
    request.method === 'PATCH' ? patch(request, context) : getOne(request)),
})
