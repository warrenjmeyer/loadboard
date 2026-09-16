const { app } = require('@azure/functions')
const { getPool, sql } = require('../db')
const identity = require('../identity')
const rules = require('../customerRules')

// ---------------------------------------------------------------------------
// Customers.
//
//   GET   /api/customers          everyone with a role: each customer with
//                                 how much freight they have on the board
//                                 and how much they have had delivered
//   POST  /api/customers          add one            (dispatcher, admin)
//   GET   /api/customers/{id}     one, with every load that was theirs
//   PATCH /api/customers/{id}     change one         (dispatcher, admin)
//
// A customer's status is the one field dispatch reads every day: Hold means
// their loads cannot be covered, and loads.js enforces that. Everything else
// here is the phone number and the terms.
// ---------------------------------------------------------------------------

const isoDate = (v) => (v ? v.toISOString().slice(0, 10) : null)
const money = (v) => (v === null || v === undefined ? 0 : Number(v))

function customerRow(r) {
  return {
    customerId: r.customer_id,
    name: r.name,
    customerType: r.customer_type,
    mcNumber: r.mc_number,
    address1: r.address1,
    city: r.city,
    state: r.state,
    postalCode: r.postal_code,
    phone: r.phone,
    email: r.email,
    contactName: r.contact_name,
    paymentTermsDays: Number(r.payment_terms_days),
    creditLimit: r.credit_limit === null ? null : Number(r.credit_limit),
    status: r.status,
    notes: r.notes,
    // What they mean to the board. Current = not finished; revenue is the
    // carrier's billing on delivered loads, which is what an invoice run
    // would total. Open revenue is what is committed but not yet delivered.
    currentLoads: Number(r.current_loads || 0),
    deliveredLoads: Number(r.delivered_loads || 0),
    deliveredRevenue: money(r.delivered_revenue),
    openRevenue: money(r.open_revenue),
    lastDelivered: isoDate(r.last_delivered),
  }
}

const SELECT = `
  SELECT c.customer_id, c.name, c.customer_type, c.mc_number, c.address1, c.city, c.state, c.postal_code,
         c.phone, c.email, c.contact_name, c.payment_terms_days, c.credit_limit, c.status, c.notes,
         s.current_loads, s.delivered_loads, s.delivered_revenue, s.open_revenue, s.last_delivered
  FROM dbo.Customers AS c
  OUTER APPLY (
    SELECT SUM(CASE WHEN l.status IN (N'Available', N'Covered', N'In Transit') THEN 1 ELSE 0 END) AS current_loads,
           SUM(CASE WHEN l.status = N'Delivered' THEN 1 ELSE 0 END) AS delivered_loads,
           SUM(CASE WHEN l.status = N'Delivered' THEN l.rate ELSE 0 END) AS delivered_revenue,
           SUM(CASE WHEN l.status IN (N'Covered', N'In Transit') THEN l.rate ELSE 0 END) AS open_revenue,
           MAX(l.delivered_date) AS last_delivered
    FROM dbo.Loads AS l WHERE l.customer_id = c.customer_id
  ) AS s`

function badRequest(errors) {
  return { status: 400, jsonBody: { error: Array.isArray(errors) ? errors.join(' ') : errors } }
}

async function gate(request, { write = false } = {}) {
  const user = await identity.currentUser(request)
  if (!user) return { error: identity.unauthorized('Sign in to see customers.') }
  if (user.role === 'none') return { error: identity.forbidden('Your account is waiting for approval.') }
  if (write && !identity.can(user, 'manageCustomers')) {
    return { error: identity.forbidden('Only a dispatcher can change customers.') }
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

function parseId(raw) {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

function bind(req, fields) {
  const assignments = []
  const columns = []
  const values = []
  for (const [name, value] of Object.entries(fields)) {
    const spec = rules.FIELDS[name]
    if (!spec) continue
    switch (spec.type) {
      case 'int': req.input(name, sql.SmallInt, value); break
      case 'money': req.input(name, sql.Decimal(12, 2), value); break
      default: req.input(name, sql.NVarChar(spec.max || 254), value)
    }
    assignments.push(`${spec.col} = @${name}`)
    columns.push(spec.col)
    values.push(`@${name}`)
  }
  return { assignments, columns, values }
}

async function listCustomers(request) {
  const g = await gate(request)
  if (g.error) return g.error
  const pool = await getPool()
  const result = await pool.request().query(`${SELECT} ORDER BY c.status, c.name;`)
  return { jsonBody: result.recordset.map(customerRow), headers: { 'Cache-Control': 'no-store' } }
}

async function getCustomer(request) {
  const g = await gate(request)
  if (g.error) return g.error
  const id = parseId(request.params.id)
  if (!id) return { status: 404, jsonBody: { error: 'No such customer.' } }

  const pool = await getPool()
  const result = await pool.request().input('id', sql.Int, id).query(`
    ${SELECT} WHERE c.customer_id = @id;
    SELECT load_number AS id, origin, destination, miles, rate, equipment, status, driver_code, unit_no, trailer_no,
           pickup_start, delivery_end, delivered_date, reference_no
    FROM dbo.Loads WHERE customer_id = @id
    ORDER BY CASE status WHEN N'In Transit' THEN 0 WHEN N'Covered' THEN 1 WHEN N'Available' THEN 2 WHEN N'Delivered' THEN 3 ELSE 4 END,
             COALESCE(delivered_date, CAST(pickup_start AS DATE)) DESC, load_number DESC;
  `)
  const row = result.recordsets[0][0]
  if (!row) return { status: 404, jsonBody: { error: 'No such customer.' } }

  return {
    jsonBody: {
      ...customerRow(row),
      loads: result.recordsets[1].map((l) => ({
        id: l.id, origin: l.origin, destination: l.destination, miles: Number(l.miles), rate: Number(l.rate),
        equipment: l.equipment, status: l.status, driverCode: l.driver_code, unitNo: l.unit_no, trailerNo: l.trailer_no,
        pickupStart: l.pickup_start ? l.pickup_start.toISOString().slice(0, 19) : null,
        deliveryEnd: l.delivery_end ? l.delivery_end.toISOString().slice(0, 19) : null,
        deliveredDate: isoDate(l.delivered_date), referenceNo: l.reference_no, hazmat: false,
      })),
    },
    headers: { 'Cache-Control': 'no-store' },
  }
}

async function createCustomer(request, context) {
  const g = await gate(request, { write: true })
  if (g.error) return g.error
  const body = await readBody(request)
  if (!body) return badRequest('Expected a JSON body.')

  const { errors, fields } = rules.validateCustomer(body)
  if (errors.length) return badRequest(errors)

  const pool = await getPool()
  const req = pool.request()
  const { columns, values } = bind(req, fields)
  const result = await req.input('by', sql.NVarChar(256), g.user.email).query(`
    INSERT INTO dbo.Customers (updated_by, ${columns.join(', ')})
    OUTPUT inserted.customer_id
    VALUES (@by, ${values.join(', ')});
  `)
  const id = result.recordset[0].customer_id
  context.log(`Customer ${id} "${fields.name}" added by ${g.user.email}`)

  const saved = await pool.request().input('id', sql.Int, id).query(`${SELECT} WHERE c.customer_id = @id;`)
  return { status: 201, jsonBody: customerRow(saved.recordset[0]), headers: { 'Cache-Control': 'no-store' } }
}

async function patchCustomer(request, context) {
  const g = await gate(request, { write: true })
  if (g.error) return g.error
  const id = parseId(request.params.id)
  if (!id) return { status: 404, jsonBody: { error: 'No such customer.' } }
  const body = await readBody(request)
  if (!body) return badRequest('Expected a JSON body.')

  const { errors, fields } = rules.validateCustomer(body, { partial: true })
  if (errors.length) return badRequest(errors)
  if (Object.keys(fields).length === 0) return badRequest('Nothing to change.')

  const pool = await getPool()
  const req = pool.request()
  const { assignments } = bind(req, fields)
  const result = await req
    .input('id', sql.Int, id)
    .input('by', sql.NVarChar(256), g.user.email)
    .query(`
      UPDATE dbo.Customers SET ${assignments.join(', ')}, updated_utc = SYSUTCDATETIME(), updated_by = @by
      WHERE customer_id = @id;
      SELECT @@ROWCOUNT AS n;
    `)
  if (!result.recordset[0].n) return { status: 404, jsonBody: { error: 'No such customer.' } }

  // A renamed customer renames the loads that carry its name, so the two
  // columns keep agreeing. Loads with a typed name and no link are not
  // touched: that name was never this record's to change.
  if (fields.name) {
    await pool.request().input('id', sql.Int, id).input('name', sql.NVarChar(100), fields.name)
      .query('UPDATE dbo.Loads SET customer_name = @name WHERE customer_id = @id;')
  }
  context.log(`Customer ${id} changed by ${g.user.email}: ${Object.keys(fields).join(', ')}`)

  const saved = await pool.request().input('id', sql.Int, id).query(`${SELECT} WHERE c.customer_id = @id;`)
  return { jsonBody: customerRow(saved.recordset[0]), headers: { 'Cache-Control': 'no-store' } }
}

function wrap(label, handler) {
  return async (request, context) => {
    try {
      return await handler(request, context)
    } catch (err) {
      if (err.number === 2627 || err.number === 2601) {
        return { status: 409, jsonBody: { error: 'A customer with that name already exists.' } }
      }
      if (err.number === 547) {
        context.error(`${label} refused by constraint:`, err.message)
        return badRequest('The database refused that change.')
      }
      context.error(`${label} failed:`, err)
      return { status: 500, jsonBody: { error: 'Could not load data.' } }
    }
  }
}

app.http('customers', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'customers',
  handler: wrap('/api/customers', (request, context) =>
    request.method === 'POST' ? createCustomer(request, context) : listCustomers(request)),
})

app.http('customer', {
  methods: ['GET', 'PATCH'],
  authLevel: 'anonymous',
  route: 'customers/{id}',
  handler: wrap('/api/customers/{id}', (request, context) =>
    request.method === 'PATCH' ? patchCustomer(request, context) : getCustomer(request)),
})
