const { app } = require('@azure/functions')
const { getPool, sql } = require('../db')
const identity = require('../identity')
const rules = require('../fleetRules')

// ---------------------------------------------------------------------------
// The fleet.
//
//   GET   /api/trucks                everyone with a role: each truck, its
//                                    regular driver, and the load it is on
//   POST  /api/trucks                add one            (dispatcher, admin)
//   PATCH /api/trucks/{unitNo}       change one         (dispatcher, admin)
//   GET   /api/trailers              same shape for trailers
//   POST  /api/trailers
//   PATCH /api/trailers/{trailerNo}
//
// Reading is open to any real role: a driver looking up which trailer is a
// reefer is a reasonable thing to want. Writing is dispatch work.
//
// Every date comes back with a `daysUntil` beside it, computed here against
// the server's date, so the fleet page can warn about a plate that expires
// next week without trusting the phone's clock.
// ---------------------------------------------------------------------------

const isoDate = (v) => (v ? v.toISOString().slice(0, 10) : null)
const today = () => new Date().toISOString().slice(0, 10)

function truckRow(r, now) {
  return {
    unitNo: r.unit_no,
    description: r.description,
    modelYear: r.model_year === null ? null : Number(r.model_year),
    make: r.make,
    model: r.model,
    vin: r.vin,
    plate: r.plate,
    plateState: r.plate_state,
    status: r.status,
    ownerType: r.owner_type,
    ownerDriverCode: r.owner_driver_code,
    registrationExpires: isoDate(r.registration_expires),
    registrationDays: rules.daysUntil(isoDate(r.registration_expires), now),
    inspectionDue: isoDate(r.inspection_due),
    inspectionDays: rules.daysUntil(isoDate(r.inspection_due), now),
    notes: r.notes,
    // Who normally drives it (Drivers.unit_no), and what it is on right now.
    regularDriver: r.driver_code ? { driverCode: r.driver_code, name: `${r.first_name} ${r.last_name}` } : null,
    currentLoad: r.load_id ? { id: r.load_id, status: r.load_status, destination: r.load_destination } : null,
  }
}

function trailerRow(r, now) {
  return {
    trailerNo: r.trailer_no,
    trailerType: r.trailer_type,
    description: r.description,
    plate: r.plate,
    plateState: r.plate_state,
    status: r.status,
    registrationExpires: isoDate(r.registration_expires),
    registrationDays: rules.daysUntil(isoDate(r.registration_expires), now),
    inspectionDue: isoDate(r.inspection_due),
    inspectionDays: rules.daysUntil(isoDate(r.inspection_due), now),
    notes: r.notes,
    currentLoad: r.load_id ? { id: r.load_id, status: r.load_status, destination: r.load_destination } : null,
  }
}

const TRUCK_SELECT = `
  SELECT t.unit_no, t.description, t.model_year, t.make, t.model, t.vin, t.plate, t.plate_state,
         t.status, t.owner_type, t.owner_driver_code, t.registration_expires, t.inspection_due, t.notes,
         d.driver_code, d.first_name, d.last_name,
         cur.id AS load_id, cur.status AS load_status, cur.destination AS load_destination
  FROM dbo.Trucks AS t
  LEFT JOIN dbo.Drivers AS d ON d.unit_no = t.unit_no
  OUTER APPLY (
    SELECT TOP 1 l.load_number AS id, l.status, l.destination
    FROM dbo.Loads AS l
    WHERE l.unit_no = t.unit_no AND l.status IN (N'Covered', N'In Transit')
    ORDER BY CASE l.status WHEN N'In Transit' THEN 0 ELSE 1 END, l.pickup_start, l.load_number
  ) AS cur`

const TRAILER_SELECT = `
  SELECT t.trailer_no, t.trailer_type, t.description, t.plate, t.plate_state, t.status,
         t.registration_expires, t.inspection_due, t.notes,
         cur.id AS load_id, cur.status AS load_status, cur.destination AS load_destination
  FROM dbo.Trailers AS t
  OUTER APPLY (
    SELECT TOP 1 l.load_number AS id, l.status, l.destination
    FROM dbo.Loads AS l
    WHERE l.trailer_no = t.trailer_no AND l.status IN (N'Covered', N'In Transit')
    ORDER BY CASE l.status WHEN N'In Transit' THEN 0 ELSE 1 END, l.pickup_start, l.load_number
  ) AS cur`

function badRequest(errors) {
  return { status: 400, jsonBody: { error: Array.isArray(errors) ? errors.join(' ') : errors } }
}

// Reading needs a role; writing needs the fleet permission. Returns the user
// or the response that ends the request.
async function gate(request, { write = false } = {}) {
  const user = await identity.currentUser(request)
  if (!user) return { error: identity.unauthorized('Sign in to see the fleet.') }
  if (user.role === 'none') return { error: identity.forbidden('Your account is waiting for approval.') }
  if (write && !identity.can(user, 'manageFleet')) {
    return { error: identity.forbidden('Only a dispatcher can change the fleet.') }
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

// One loop over the field table produces the typed parameters and the SQL
// fragments, the same way loads.js does it.
function bind(req, FIELDS, fields) {
  const assignments = []
  const columns = []
  const values = []
  for (const [name, value] of Object.entries(fields)) {
    const spec = FIELDS[name]
    if (!spec) continue
    switch (spec.type) {
      case 'int': req.input(name, sql.SmallInt, value); break
      case 'date': req.input(name, sql.VarChar(10), value); break
      default: req.input(name, sql.NVarChar(spec.max || 50), value)
    }
    const expr = spec.type === 'date' ? `CAST(@${name} AS DATE)` : `@${name}`
    assignments.push(`${spec.col} = ${expr}`)
    columns.push(spec.col)
    values.push(expr)
  }
  return { assignments, columns, values }
}

// ---------------------------------------------------------------------------
// Trucks
// ---------------------------------------------------------------------------
async function listTrucks(request) {
  const g = await gate(request)
  if (g.error) return g.error
  const pool = await getPool()
  const result = await pool.request().query(`${TRUCK_SELECT} ORDER BY t.status, t.unit_no;`)
  const now = today()
  return { jsonBody: result.recordset.map((r) => truckRow(r, now)), headers: { 'Cache-Control': 'no-store' } }
}

async function createTruck(request, context) {
  const g = await gate(request, { write: true })
  if (g.error) return g.error
  const body = await readBody(request)
  if (!body) return badRequest('Expected a JSON body.')

  const unit = rules.validateUnitNo(body.unitNo)
  const { errors, fields } = rules.validateTruck(body)
  if (unit.error) errors.unshift(unit.error)
  if (errors.length) return badRequest(errors)

  const pool = await getPool()
  const req = pool.request()
  const { columns, values } = bind(req, rules.TRUCK_FIELDS, fields)
  await req
    .input('unitNo', sql.VarChar(20), unit.value)
    .input('by', sql.NVarChar(256), g.user.email)
    .query(`
      IF EXISTS (SELECT 1 FROM dbo.Trucks WHERE unit_no = @unitNo) THROW 50409, 'duplicate', 1;
      INSERT INTO dbo.Trucks (unit_no, updated_by, ${columns.join(', ')})
      VALUES (@unitNo, @by, ${values.join(', ')});
    `)
  context.log(`Truck ${unit.value} added by ${g.user.email}`)

  const saved = await pool.request().input('u', sql.VarChar(20), unit.value).query(`${TRUCK_SELECT} WHERE t.unit_no = @u;`)
  return { status: 201, jsonBody: truckRow(saved.recordset[0], today()), headers: { 'Cache-Control': 'no-store' } }
}

async function patchTruck(request, context) {
  const g = await gate(request, { write: true })
  if (g.error) return g.error
  const unit = rules.validateUnitNo(request.params.unitNo)
  if (unit.error) return { status: 404, jsonBody: { error: 'No such truck.' } }
  const body = await readBody(request)
  if (!body) return badRequest('Expected a JSON body.')

  const { errors, fields } = rules.validateTruck(body, { partial: true })
  if (errors.length) return badRequest(errors)
  if (Object.keys(fields).length === 0) return badRequest('Nothing to change.')

  const pool = await getPool()
  const req = pool.request()
  const { assignments } = bind(req, rules.TRUCK_FIELDS, fields)
  const result = await req
    .input('unitNo', sql.VarChar(20), unit.value)
    .input('by', sql.NVarChar(256), g.user.email)
    .query(`
      UPDATE dbo.Trucks SET ${assignments.join(', ')}, updated_utc = SYSUTCDATETIME(), updated_by = @by
      WHERE unit_no = @unitNo;
      SELECT @@ROWCOUNT AS n;
    `)
  if (!result.recordset[0].n) return { status: 404, jsonBody: { error: 'No such truck.' } }
  context.log(`Truck ${unit.value} changed by ${g.user.email}: ${Object.keys(fields).join(', ')}`)

  const saved = await pool.request().input('u', sql.VarChar(20), unit.value).query(`${TRUCK_SELECT} WHERE t.unit_no = @u;`)
  return { jsonBody: truckRow(saved.recordset[0], today()), headers: { 'Cache-Control': 'no-store' } }
}

// ---------------------------------------------------------------------------
// Trailers
// ---------------------------------------------------------------------------
async function listTrailers(request) {
  const g = await gate(request)
  if (g.error) return g.error
  const pool = await getPool()
  const result = await pool.request().query(`${TRAILER_SELECT} ORDER BY t.status, t.trailer_no;`)
  const now = today()
  return { jsonBody: result.recordset.map((r) => trailerRow(r, now)), headers: { 'Cache-Control': 'no-store' } }
}

async function createTrailer(request, context) {
  const g = await gate(request, { write: true })
  if (g.error) return g.error
  const body = await readBody(request)
  if (!body) return badRequest('Expected a JSON body.')

  const no = rules.validateUnitNo(body.trailerNo, 'Trailer #')
  const { errors, fields } = rules.validateTrailer(body)
  if (no.error) errors.unshift(no.error)
  if (errors.length) return badRequest(errors)

  const pool = await getPool()
  const req = pool.request()
  const { columns, values } = bind(req, rules.TRAILER_FIELDS, fields)
  await req
    .input('no', sql.VarChar(20), no.value)
    .input('by', sql.NVarChar(256), g.user.email)
    .query(`
      IF EXISTS (SELECT 1 FROM dbo.Trailers WHERE trailer_no = @no) THROW 50409, 'duplicate', 1;
      INSERT INTO dbo.Trailers (trailer_no, updated_by, ${columns.join(', ')})
      VALUES (@no, @by, ${values.join(', ')});
    `)
  context.log(`Trailer ${no.value} added by ${g.user.email}`)

  const saved = await pool.request().input('n', sql.VarChar(20), no.value).query(`${TRAILER_SELECT} WHERE t.trailer_no = @n;`)
  return { status: 201, jsonBody: trailerRow(saved.recordset[0], today()), headers: { 'Cache-Control': 'no-store' } }
}

async function patchTrailer(request, context) {
  const g = await gate(request, { write: true })
  if (g.error) return g.error
  const no = rules.validateUnitNo(request.params.trailerNo, 'Trailer #')
  if (no.error) return { status: 404, jsonBody: { error: 'No such trailer.' } }
  const body = await readBody(request)
  if (!body) return badRequest('Expected a JSON body.')

  const { errors, fields } = rules.validateTrailer(body, { partial: true })
  if (errors.length) return badRequest(errors)
  if (Object.keys(fields).length === 0) return badRequest('Nothing to change.')

  const pool = await getPool()
  const req = pool.request()
  const { assignments } = bind(req, rules.TRAILER_FIELDS, fields)
  const result = await req
    .input('no', sql.VarChar(20), no.value)
    .input('by', sql.NVarChar(256), g.user.email)
    .query(`
      UPDATE dbo.Trailers SET ${assignments.join(', ')}, updated_utc = SYSUTCDATETIME(), updated_by = @by
      WHERE trailer_no = @no;
      SELECT @@ROWCOUNT AS n;
    `)
  if (!result.recordset[0].n) return { status: 404, jsonBody: { error: 'No such trailer.' } }
  context.log(`Trailer ${no.value} changed by ${g.user.email}: ${Object.keys(fields).join(', ')}`)

  const saved = await pool.request().input('n', sql.VarChar(20), no.value).query(`${TRAILER_SELECT} WHERE t.trailer_no = @n;`)
  return { jsonBody: trailerRow(saved.recordset[0], today()), headers: { 'Cache-Control': 'no-store' } }
}

// ---------------------------------------------------------------------------
function wrap(label, handler) {
  return async (request, context) => {
    try {
      return await handler(request, context)
    } catch (err) {
      if (err.number === 50409 || err.number === 2627 || err.number === 2601) {
        return { status: 409, jsonBody: { error: 'That number is already in the fleet.' } }
      }
      if (err.number === 547) {
        context.error(`${label} refused by constraint:`, err.message)
        return badRequest(/FK_Trucks_owner/.test(err.message)
          ? 'There is no driver with that code.'
          : /FK_Drivers_truck|FK_Loads_truck|FK_Loads_trailer/.test(err.message)
            ? 'That unit is still referenced by a driver or a load.'
            : 'The database refused that change.')
      }
      context.error(`${label} failed:`, err)
      return { status: 500, jsonBody: { error: 'Could not load data.' } }
    }
  }
}

app.http('trucks', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'trucks',
  handler: wrap('/api/trucks', (request, context) =>
    request.method === 'POST' ? createTruck(request, context) : listTrucks(request)),
})

app.http('truck', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'trucks/{unitNo}',
  handler: wrap('/api/trucks/{unitNo}', patchTruck),
})

app.http('trailers', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'trailers',
  handler: wrap('/api/trailers', (request, context) =>
    request.method === 'POST' ? createTrailer(request, context) : listTrailers(request)),
})

app.http('trailer', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'trailers/{trailerNo}',
  handler: wrap('/api/trailers/{trailerNo}', patchTrailer),
})
