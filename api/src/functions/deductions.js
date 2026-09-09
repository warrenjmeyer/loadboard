const { app } = require('@azure/functions')
const { getPool, sql } = require('../db')
const identity = require('../identity')
const rules = require('../deductionRules')

// ---------------------------------------------------------------------------
// Standing deductions.
//
//   GET   /api/deductions?driver=CODE   this driver's standing orders
//   POST  /api/deductions               add one   { driverCode, ...fields }
//   PATCH /api/deductions/{id}          change one
//
// Admin only, like the pay run that reads them: these decide what comes out
// of somebody's pay every week.
// ---------------------------------------------------------------------------

const isoDate = (v) => (v ? v.toISOString().slice(0, 10) : null)
const DRIVER_CODE = /^[A-Za-z0-9_-]{1,20}$/

function row(r) {
  return {
    deductionId: r.deduction_id,
    driverCode: r.driver_code,
    code: r.code,
    description: r.description,
    basis: r.basis,
    amount: Number(r.amount),
    escrowCode: r.escrow_code,
    escrowOpening: r.escrow_opening === null ? null : Number(r.escrow_opening),
    balance: r.balance === null ? null : Number(r.balance),
    startDate: isoDate(r.start_date),
    endDate: isoDate(r.end_date),
    active: Boolean(r.active),
    notes: r.notes,
  }
}

const SELECT = `
  SELECT deduction_id, driver_code, code, description, basis, amount, escrow_code, escrow_opening,
         balance, start_date, end_date, active, notes
  FROM dbo.DriverDeductions`

function badRequest(errors) {
  return { status: 400, jsonBody: { error: Array.isArray(errors) ? errors.join(' ') : errors } }
}

async function gate(request) {
  const user = await identity.currentUser(request)
  if (!user) return { error: identity.unauthorized('Sign in to manage deductions.') }
  if (!identity.can(user, 'runPayroll')) return { error: identity.forbidden('Only an administrator can manage deductions.') }
  return { user }
}

async function readBody(request) {
  try {
    return (await request.json()) || {}
  } catch {
    return null
  }
}

function bind(req, fields) {
  const assignments = []
  const columns = []
  const values = []
  for (const [name, value] of Object.entries(fields)) {
    const spec = rules.FIELDS[name]
    if (!spec) continue
    switch (spec.type) {
      case 'amount': req.input(name, sql.Decimal(12, 4), value); break
      case 'money': req.input(name, sql.Decimal(12, 2), value); break
      case 'bool': req.input(name, sql.Bit, value); break
      case 'date': req.input(name, sql.VarChar(10), value); break
      default: req.input(name, sql.NVarChar(spec.max || 20), value)
    }
    const expr = spec.type === 'date' ? `CAST(@${name} AS DATE)` : `@${name}`
    assignments.push(`${spec.col} = ${expr}`)
    columns.push(spec.col)
    values.push(expr)
  }
  return { assignments, columns, values }
}

async function list(request) {
  const g = await gate(request)
  if (g.error) return g.error
  const driver = (request.query.get('driver') || '').trim().toUpperCase()
  if (!DRIVER_CODE.test(driver)) return badRequest('Say which driver: ?driver=CODE')

  const pool = await getPool()
  const result = await pool.request().input('d', sql.VarChar(20), driver)
    .query(`${SELECT} WHERE driver_code = @d ORDER BY active DESC, code;`)
  return { jsonBody: result.recordset.map(row), headers: { 'Cache-Control': 'no-store' } }
}

async function create(request, context) {
  const g = await gate(request)
  if (g.error) return g.error
  const body = await readBody(request)
  if (!body) return badRequest('Expected a JSON body.')

  const driver = typeof body.driverCode === 'string' ? body.driverCode.trim().toUpperCase() : ''
  const { errors, fields } = rules.validateDeduction(body)
  if (!DRIVER_CODE.test(driver)) errors.unshift('Driver code is required.')
  if (errors.length) return badRequest(errors)

  const pool = await getPool()
  const req = pool.request()
  const { columns, values } = bind(req, fields)
  const result = await req
    .input('driver', sql.VarChar(20), driver)
    .input('by', sql.NVarChar(256), g.user.email)
    .query(`
      INSERT INTO dbo.DriverDeductions (driver_code, updated_by, ${columns.join(', ')})
      OUTPUT inserted.deduction_id
      VALUES (@driver, @by, ${values.join(', ')});
    `)
  const id = result.recordset[0].deduction_id
  context.log(`Deduction ${id} ${fields.code} for ${driver} added by ${g.user.email}`)

  const saved = await pool.request().input('id', sql.Int, id).query(`${SELECT} WHERE deduction_id = @id;`)
  return { status: 201, jsonBody: row(saved.recordset[0]), headers: { 'Cache-Control': 'no-store' } }
}

async function patch(request, context) {
  const g = await gate(request)
  if (g.error) return g.error
  const id = Number(request.params.id)
  if (!Number.isInteger(id) || id <= 0) return { status: 404, jsonBody: { error: 'No such deduction.' } }
  const body = await readBody(request)
  if (!body) return badRequest('Expected a JSON body.')

  const { errors, fields } = rules.validateDeduction(body, { partial: true })
  if (errors.length) return badRequest(errors)
  if (Object.keys(fields).length === 0) return badRequest('Nothing to change.')

  const pool = await getPool()
  const req = pool.request()
  const { assignments } = bind(req, fields)
  const result = await req
    .input('id', sql.Int, id)
    .input('by', sql.NVarChar(256), g.user.email)
    .query(`
      UPDATE dbo.DriverDeductions SET ${assignments.join(', ')}, updated_utc = SYSUTCDATETIME(), updated_by = @by
      WHERE deduction_id = @id;
      SELECT @@ROWCOUNT AS n;
    `)
  if (!result.recordset[0].n) return { status: 404, jsonBody: { error: 'No such deduction.' } }
  context.log(`Deduction ${id} changed by ${g.user.email}: ${Object.keys(fields).join(', ')}`)

  const saved = await pool.request().input('id', sql.Int, id).query(`${SELECT} WHERE deduction_id = @id;`)
  return { jsonBody: row(saved.recordset[0]), headers: { 'Cache-Control': 'no-store' } }
}

function wrap(label, handler) {
  return async (request, context) => {
    try {
      return await handler(request, context)
    } catch (err) {
      if (err.number === 2627 || err.number === 2601) {
        return { status: 409, jsonBody: { error: 'That driver already has a deduction with that code.' } }
      }
      if (err.number === 547) {
        context.error(`${label} refused by constraint:`, err.message)
        return badRequest(/FK_Deductions_driver/.test(err.message) ? 'There is no driver with that code.' : 'The database refused that change.')
      }
      context.error(`${label} failed:`, err)
      return { status: 500, jsonBody: { error: 'Could not load data.' } }
    }
  }
}

app.http('deductions', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'deductions',
  handler: wrap('/api/deductions', (request, context) =>
    request.method === 'POST' ? create(request, context) : list(request)),
})

app.http('deduction', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'deductions/{id}',
  handler: wrap('/api/deductions/{id}', patch),
})
