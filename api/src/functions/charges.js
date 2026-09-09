const { app } = require('@azure/functions')
const { getPool, sql } = require('../db')
const identity = require('../identity')
const rules = require('../chargeRules')

// ---------------------------------------------------------------------------
// Accessorial charges on a load.
//
//   GET    /api/loads/{id}/charges   any real role; the load's charges and
//                                    which statement paid each
//   POST   /api/loads/{id}/charges   dispatcher, admin: anything;
//                                    the driver on the load: a REIMBURSEMENT
//   DELETE /api/charges/{chargeId}   dispatcher, admin, and only while unpaid
//
// No PATCH. A charge is small enough that "delete it and enter it again" is
// the honest edit, and a paid charge is part of a statement somebody has,
// so it is not edited at all -- a correction is a new charge.
// ---------------------------------------------------------------------------

const LOAD_ID = /^[A-Za-z0-9._-]{1,20}$/

function row(r) {
  return {
    chargeId: r.charge_id,
    loadId: r.load_id,
    lineType: r.line_type,
    code: r.code,
    description: r.description,
    amount: Number(r.amount),
    billCustomer: Boolean(r.bill_customer),
    billAmount: r.bill_amount === null ? null : Number(r.bill_amount),
    receiptNote: r.receipt_note,
    createdUtc: r.created_utc ? r.created_utc.toISOString() : null,
    createdBy: r.created_by,
    // Which statement paid it, when one has.
    paidOn: r.document_no ? { documentNo: r.document_no, checkDate: r.check_date.toISOString().slice(0, 10), driverCode: r.driver_code } : null,
    // Which invoice billed it to the customer, when one has.
    billedOn: r.invoice_no ? { invoiceNo: r.invoice_no, invoiceDate: r.invoice_date.toISOString().slice(0, 10) } : null,
  }
}

const SELECT = `
  SELECT c.charge_id, c.load_id, c.line_type, c.code, c.description, c.amount, c.bill_customer, c.bill_amount,
         c.receipt_note, c.created_utc, c.created_by,
         s.document_no, s.check_date, s.driver_code,
         inv.invoice_no, inv.invoice_date
  FROM dbo.LoadCharges AS c
  LEFT JOIN dbo.SettlementLines AS l ON l.line_id = c.settlement_line_id
  LEFT JOIN dbo.Settlements AS s ON s.settlement_id = l.settlement_id
  LEFT JOIN dbo.InvoiceLines AS il ON il.line_id = c.invoice_line_id
  LEFT JOIN dbo.Invoices AS inv ON inv.invoice_id = il.invoice_id`

function badRequest(errors) {
  return { status: 400, jsonBody: { error: Array.isArray(errors) ? errors.join(' ') : errors } }
}

async function loadFor(pool, id) {
  const r = await pool.request().input('id', sql.VarChar(20), id)
    .query('SELECT id, status, driver_code FROM dbo.Loads WHERE id = @id;')
  return r.recordset[0] ? { id: r.recordset[0].id, status: r.recordset[0].status, driverCode: r.recordset[0].driver_code } : null
}

async function list(request) {
  const id = request.params.id
  if (!LOAD_ID.test(id)) return { status: 404, jsonBody: { error: 'That load is not on the board.' } }
  const user = await identity.currentUser(request)
  if (!user) return identity.unauthorized('Sign in to see charges.')
  if (user.role === 'none') return identity.forbidden('Your account is waiting for approval.')

  const pool = await getPool()
  const result = await pool.request().input('id', sql.VarChar(20), id)
    .query(`${SELECT} WHERE c.load_id = @id ORDER BY c.created_utc, c.charge_id;`)
  return { jsonBody: result.recordset.map(row), headers: { 'Cache-Control': 'no-store' } }
}

async function create(request, context) {
  const id = request.params.id
  if (!LOAD_ID.test(id)) return { status: 404, jsonBody: { error: 'That load is not on the board.' } }
  const user = await identity.currentUser(request)
  if (!user) return identity.unauthorized('Sign in to add a charge.')
  if (user.role === 'none') return identity.forbidden('Your account is waiting for approval.')

  let body
  try {
    body = (await request.json()) || {}
  } catch {
    return badRequest('Expected a JSON body.')
  }
  const { errors, charge } = rules.validateCharge(body)
  if (errors.length) return badRequest(errors)

  const pool = await getPool()
  const load = await loadFor(pool, id)
  if (!load) return { status: 404, jsonBody: { error: 'That load is not on the board.' } }
  if (!rules.canAdd(user, load, charge)) {
    return identity.forbidden(user.role === 'driver'
      ? 'You can add a reimbursement -- tolls, a lumper, the scale -- on your own load. Anything else goes through dispatch.'
      : 'Your account does not have permission to add charges.')
  }
  if (load.status === 'Cancelled') return badRequest('A cancelled load cannot carry charges.')

  const result = await pool.request()
    .input('id', sql.VarChar(20), id)
    .input('type', sql.VarChar(15), charge.lineType)
    .input('code', sql.VarChar(20), charge.code)
    .input('description', sql.NVarChar(120), charge.description)
    .input('amount', sql.Decimal(12, 2), charge.amount)
    .input('bill', sql.Bit, charge.billCustomer)
    .input('billAmount', sql.Decimal(12, 2), charge.billAmount)
    .input('note', sql.NVarChar(200), charge.receiptNote)
    .input('by', sql.NVarChar(256), user.email)
    .query(`
      INSERT INTO dbo.LoadCharges (load_id, line_type, code, description, amount, bill_customer, bill_amount, receipt_note, created_by)
      OUTPUT inserted.charge_id
      VALUES (@id, @type, @code, @description, @amount, @bill, @billAmount, @note, @by);

      INSERT INTO dbo.LoadEvents (load_id, actor, event_type, detail)
      VALUES (@id, @by, 'Edited', CONCAT(N'Added ', @description, N' ', FORMAT(@amount, 'N2')));
    `)
  const chargeId = result.recordset[0].charge_id
  context.log(`Charge ${chargeId} ${charge.code} ${charge.amount} on ${id} by ${user.email}`)

  const saved = await pool.request().input('c', sql.Int, chargeId).query(`${SELECT} WHERE c.charge_id = @c;`)
  return { status: 201, jsonBody: row(saved.recordset[0]), headers: { 'Cache-Control': 'no-store' } }
}

async function remove(request, context) {
  const chargeId = Number(request.params.chargeId)
  if (!Number.isInteger(chargeId) || chargeId <= 0) return { status: 404, jsonBody: { error: 'No such charge.' } }
  const user = await identity.currentUser(request)
  if (!user) return identity.unauthorized('Sign in to remove a charge.')
  if (!identity.can(user, 'editLoad')) return identity.forbidden('Only a dispatcher can remove a charge.')

  const pool = await getPool()
  const found = await pool.request().input('c', sql.Int, chargeId)
    .query('SELECT load_id, description, amount, settlement_line_id, invoice_line_id FROM dbo.LoadCharges WHERE charge_id = @c;')
  const c = found.recordset[0]
  if (!c) return { status: 404, jsonBody: { error: 'No such charge.' } }
  if (c.settlement_line_id) {
    return { status: 409, jsonBody: { error: 'That charge has been paid on a statement. Enter a correcting charge instead.' } }
  }
  if (c.invoice_line_id) {
    return { status: 409, jsonBody: { error: 'That charge has been billed to the customer. Void the invoice, or enter a correcting charge.' } }
  }

  await pool.request()
    .input('c', sql.Int, chargeId)
    .input('id', sql.VarChar(20), c.load_id)
    .input('by', sql.NVarChar(256), user.email)
    .input('detail', sql.NVarChar(400), `Removed ${c.description} ${Number(c.amount).toFixed(2)}`)
    .query(`
      DELETE FROM dbo.LoadCharges WHERE charge_id = @c;
      INSERT INTO dbo.LoadEvents (load_id, actor, event_type, detail) VALUES (@id, @by, 'Edited', @detail);
    `)
  context.log(`Charge ${chargeId} on ${c.load_id} removed by ${user.email}`)
  return { status: 204 }
}

function wrap(label, handler) {
  return async (request, context) => {
    try {
      return await handler(request, context)
    } catch (err) {
      context.error(`${label} failed:`, err)
      return { status: 500, jsonBody: { error: 'Could not load data.' } }
    }
  }
}

app.http('loadCharges', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'loads/{id}/charges',
  handler: wrap('/api/loads/{id}/charges', (request, context) =>
    request.method === 'POST' ? create(request, context) : list(request)),
})

app.http('charge', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'charges/{chargeId}',
  handler: wrap('/api/charges/{chargeId}', remove),
})
