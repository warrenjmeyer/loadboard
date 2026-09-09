const { app } = require('@azure/functions')
const { getPool, sql } = require('../db')
const identity = require('../identity')
const rules = require('../loadRules')

// ---------------------------------------------------------------------------
// The load routes.
//
//   GET   /api/loads               the board
//   POST  /api/loads               create one (dispatcher, admin)
//   GET   /api/loads/{id}          one load, plus what the caller may do to it
//   PATCH /api/loads/{id}          change it: details, assignment, status
//   GET   /api/loads/{id}/events   what has happened to it, in order
//   GET   /api/roster              every driver and what they are on
//
// This is the piece a static site cannot have. The credential lives in the
// Function App's settings (see set-api-secrets.ps1), so it exists only on the
// server; the browser receives rows and never sees a connection string.
//
// The rules -- which fields, which moves, who may make them -- live in
// ../loadRules.js and are tested there. This file is the SQL and the HTTP.
//
// Methods that share a route share one registration. Azure Functions keys a
// function by name, and two registrations claiming the same `route` is the
// kind of ambiguity that either errors at startup or -- worse -- silently
// resolves to whichever loaded first. One route, one owner, dispatch inside.
// ---------------------------------------------------------------------------

const LOAD_ID = /^[A-Za-z0-9._-]{1,20}$/

// Explicit column list: it keeps the shape stable if someone adds a column
// to the table later, and it is the one place the SQL names them.
const LOAD_COLUMNS = [
  'id', 'origin', 'destination', 'miles', 'empty_miles', 'rate', 'equipment', 'status',
  'driver_code', 'unit_no', 'trailer_no', 'delivered_date',
  'pickup_start', 'pickup_end', 'delivery_start', 'delivery_end',
  'customer_id', 'customer_name', 'reference_no',
  'shipper_name', 'shipper_address', 'shipper_phone',
  'consignee_name', 'consignee_address', 'consignee_phone',
  'commodity', 'weight_lbs', 'pieces', 'hazmat', 'temp_f', 'notes',
  'created_utc', 'created_by', 'updated_utc', 'updated_by',
]

// The customer's status rides along with every load, because whether a load
// may be covered depends on it (see loadRules.planChange). A LEFT JOIN, so a
// load with no customer record is still a load.
const FROM_LOADS = (hint = '') => `
  SELECT ${LOAD_COLUMNS.map((c) => `l.${c}`).join(', ')}, c.status AS customer_status
  FROM dbo.Loads AS l ${hint}
  LEFT JOIN dbo.Customers AS c ON c.customer_id = l.customer_id`

// DATE and DATETIME2 come back as JS Dates holding the stored components as
// UTC (mssql's useUTC default). Slicing the ISO string hands back exactly the
// digits SQL holds, with no timezone applied on the way -- which is right,
// because an appointment is in the dock's local time and a delivered date is
// a date.
const isoDate = (v) => (v ? v.toISOString().slice(0, 10) : null)
const isoDateTime = (v) => (v ? v.toISOString().slice(0, 19) : null)

function rowToLoad(r) {
  return {
    id: r.id,
    origin: r.origin,
    destination: r.destination,
    miles: Number(r.miles),
    emptyMiles: Number(r.empty_miles || 0),
    // rate is DECIMAL(10,2); Number() keeps 585.00 serialising as 585,
    // matching what the front end already expects.
    rate: Number(r.rate),
    equipment: r.equipment,
    status: r.status,
    driverCode: r.driver_code,
    unitNo: r.unit_no,
    trailerNo: r.trailer_no,
    deliveredDate: isoDate(r.delivered_date),
    pickupStart: isoDateTime(r.pickup_start),
    pickupEnd: isoDateTime(r.pickup_end),
    deliveryStart: isoDateTime(r.delivery_start),
    deliveryEnd: isoDateTime(r.delivery_end),
    customerId: r.customer_id,
    customerName: r.customer_name,
    customerStatus: r.customer_status || null,
    referenceNo: r.reference_no,
    shipperName: r.shipper_name,
    shipperAddress: r.shipper_address,
    shipperPhone: r.shipper_phone,
    consigneeName: r.consignee_name,
    consigneeAddress: r.consignee_address,
    consigneePhone: r.consignee_phone,
    commodity: r.commodity,
    weightLbs: r.weight_lbs === null ? null : Number(r.weight_lbs),
    pieces: r.pieces === null ? null : Number(r.pieces),
    hazmat: Boolean(r.hazmat),
    tempF: r.temp_f === null ? null : Number(r.temp_f),
    notes: r.notes,
    createdUtc: r.created_utc ? r.created_utc.toISOString() : null,
    createdBy: r.created_by,
    updatedUtc: r.updated_utc ? r.updated_utc.toISOString() : null,
    updatedBy: r.updated_by,
  }
}

// The same load as an anonymous visitor sees it: the freight and nothing
// about the people. Every non-public key is present and null rather than
// absent, so the front end renders one shape and never has to ask which
// version it was handed.
function publicView(load) {
  const out = {}
  for (const key of Object.keys(load)) {
    out[key] = rules.PUBLIC_FIELDS.has(key) ? load[key] : null
  }
  return out
}

// A signed-in account with a real role sees everything, including who is on
// what. An account with no role yet does not count: "powerless until
// approved" has to mean it here too, or registering becomes a way to read the
// history.
function seesEverything(user) {
  return Boolean(user) && user.role !== 'none'
}

function badRequest(errors) {
  return { status: 400, jsonBody: { error: Array.isArray(errors) ? errors.join(' ') : errors } }
}

function notFound() {
  return { status: 404, jsonBody: { error: 'That load is not on the board.' } }
}

// ---------------------------------------------------------------------------
// Binding fields to a request. One loop over rules.FIELDS produces both the
// typed parameters and the SQL fragments, so a field added to FIELDS is
// written without touching this file.
//
// Datetimes are bound as ISO STRINGS and cast in SQL, not passed as JS Dates.
// A Date would be shifted by whatever timezone the Functions host runs in,
// and an appointment window that moves by five hours between a laptop and
// Azure is the kind of bug that only shows up in production.
// ---------------------------------------------------------------------------
function bindFields(req, fields) {
  const assignments = []
  const columns = []
  const values = []

  for (const [name, value] of Object.entries(fields)) {
    const spec = rules.FIELDS[name]
    if (!spec) continue

    let expr = `@${name}`
    switch (spec.type) {
      case 'text':
        req.input(name, sql.NVarChar(spec.max), value)
        break
      case 'int':
        // empty_miles is NOT NULL DEFAULT 0: a cleared box means zero, not
        // unknown, and the column would refuse the null.
        req.input(name, sql.Int, name === 'emptyMiles' && value === null ? 0 : value)
        break
      case 'money':
        req.input(name, sql.Decimal(10, 2), value)
        break
      case 'enum':
        req.input(name, sql.NVarChar(50), value)
        break
      case 'bool':
        req.input(name, sql.Bit, value)
        break
      case 'id':
        req.input(name, sql.Int, value)
        break
      case 'datetime':
        req.input(name, sql.VarChar(19), value)
        expr = `CAST(@${name} AS DATETIME2(0))`
        break
      default:
        continue
    }

    assignments.push(`${spec.col} = ${expr}`)
    columns.push(spec.col)
    values.push(expr)
  }

  return { assignments, columns, values }
}

async function selectLoad(req, id) {
  const result = await req.input('id', sql.VarChar(20), id).query(`
    ${FROM_LOADS()} WHERE l.id = @id;
  `)
  return result.recordset[0] ? rowToLoad(result.recordset[0]) : null
}

// A customer id becomes the customer's name on the load, so customer_name
// always says what customer_id points at. Returns the name, or null when no
// such customer exists -- which the caller turns into a 400.
async function customerName(req, customerId) {
  const r = await req.input('cid', sql.Int, customerId).query('SELECT name FROM dbo.Customers WHERE customer_id = @cid;')
  return r.recordset[0] ? r.recordset[0].name : null
}

async function insertEvent(req, load, event, actor) {
  await req
    .input('evLoad', sql.VarChar(20), load.id)
    .input('evActor', sql.NVarChar(256), actor)
    .input('evType', sql.VarChar(20), event.type)
    .input('evFrom', sql.NVarChar(20), event.fromStatus || null)
    .input('evTo', sql.NVarChar(20), event.toStatus || null)
    .input('evDriver', sql.VarChar(20), event.driverCode || null)
    .input('evDetail', sql.NVarChar(400), event.detail || null)
    .query(`
      INSERT INTO dbo.LoadEvents (load_id, actor, event_type, from_status, to_status, driver_code, detail)
      VALUES (@evLoad, @evActor, @evType, @evFrom, @evTo, @evDriver, @evDetail);
    `)
}

// ---------------------------------------------------------------------------
// GET /api/loads
// ---------------------------------------------------------------------------
async function listLoads(request) {
  // What the public may see is CURRENT FREIGHT: available, covered or moving,
  // with nobody's name on it. That is what a load board is for.
  //
  // Delivered and cancelled history is a different thing wearing the same
  // shape. Every delivered row carries a driver code and a date, so serving
  // them anonymously published which driver hauled which lane, when, for how
  // much -- and the whole roster of driver codes with it.
  const user = await identity.currentUser(request)
  const all = seesEverything(user)

  const pool = await getPool()
  const result = await pool.request().query(`
    ${FROM_LOADS()} ORDER BY l.id;
  `)

  const rows = all
    ? result.recordset.map(rowToLoad)
    : result.recordset
        .filter((r) => rules.PUBLIC_STATUSES.has(r.status))
        .map((r) => publicView(rowToLoad(r)))

  return {
    jsonBody: rows,
    // The data changes rarely and a stale board is worse than a slow one, so
    // no caching. Revisit if this ever gets traffic.
    headers: { 'Cache-Control': 'no-store' },
  }
}

// ---------------------------------------------------------------------------
// POST /api/loads
// ---------------------------------------------------------------------------
async function createLoad(request, context) {
  // Authorization comes from the auth.Users row, whichever door they came in
  // by -- the app's own session cookie or Static Web Apps' platform login.
  const user = await identity.currentUser(request)
  if (!user) return identity.unauthorized('Sign in to add a load.')

  if (!identity.can(user, 'addLoad')) {
    // 403, not 401: signing in again will not help. A pending account is told
    // that specifically, because "your account is waiting for approval" and
    // "you may not do this" call for different next steps.
    return identity.forbidden(
      user.role === 'none'
        ? 'Your account is waiting for approval before you can add loads.'
        : 'Your account does not have permission to add loads.'
    )
  }

  let body
  try {
    body = (await request.json()) || {}
  } catch {
    return badRequest('Expected a JSON body.')
  }

  const errors = []
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) errors.push('Load # is required.')
  else if (!LOAD_ID.test(id)) errors.push('Load # may only contain letters, digits, dots, dashes and underscores, up to 20 characters.')

  const { errors: fieldErrors, fields } = rules.validateFields(body)
  errors.push(...fieldErrors)
  if (errors.length) return badRequest(errors)

  const pool = await getPool()
  const tx = new sql.Transaction(pool)
  await tx.begin()

  try {
    if (fields.customerId) {
      const name = await customerName(new sql.Request(tx), fields.customerId)
      if (!name) {
        await tx.rollback()
        return badRequest('There is no customer with that id.')
      }
      fields.customerName = name
    }

    const req = new sql.Request(tx)
    const { columns, values } = bindFields(req, fields)

    // Parameterised, every value. Never build this string by interpolation --
    // a destination of  x'); DROP TABLE dbo.Loads; --  is an ordinary thing
    // for a text input to contain, and the only reason it is harmless here is
    // that .input() sends it as data and never as SQL.
    //
    // status is hard-coded, not read from the body. A load that has just been
    // created is Available by definition, and accepting the value from the
    // client would let a POST claim Delivered with no driver attached.
    await req
      .input('id', sql.VarChar(20), id)
      .input('createdBy', sql.NVarChar(256), user.email)
      .query(`
        IF EXISTS (SELECT 1 FROM dbo.Loads WHERE id = @id)
          THROW 50409, 'duplicate', 1;

        INSERT INTO dbo.Loads (id, status, created_by, ${columns.join(', ')})
        VALUES (@id, N'Available', @createdBy, ${values.join(', ')});
      `)

    const load = await selectLoad(new sql.Request(tx), id)
    await insertEvent(new sql.Request(tx), load, { type: 'Created', detail: `${load.origin} → ${load.destination}` }, user.email)
    await tx.commit()

    context.log(`Load ${id} created by ${user.email} (${user.role}, via ${user.via})`)

    // 201 with the row the database actually wrote, not the row that was
    // sent. They differ: status was filled in here, and DECIMAL(10,2) has
    // already rounded the rate. What is stored is what the board should show.
    return {
      status: 201,
      jsonBody: { ...load, actions: rules.actionsFor(user, load) },
      headers: { 'Cache-Control': 'no-store' },
    }
  } catch (err) {
    await tx.rollback().catch(() => {})
    throw err
  }
}

// ---------------------------------------------------------------------------
// GET /api/loads/{id}
// ---------------------------------------------------------------------------
async function getLoad(request) {
  const id = request.params.id
  if (!LOAD_ID.test(id)) return notFound()

  const user = await identity.currentUser(request)
  const pool = await getPool()
  const load = await selectLoad(pool.request(), id)

  // Not found and not permitted are the same answer on purpose. A delivered
  // load is invisible to a signed-out visitor, and 403 would confirm the load
  // exists -- which, for a load that names a driver, is the leak.
  if (!load) return notFound()
  if (!seesEverything(user)) {
    if (!rules.PUBLIC_STATUSES.has(load.status)) return notFound()
    return { jsonBody: { ...publicView(load), actions: rules.actionsFor(null, load) }, headers: { 'Cache-Control': 'no-store' } }
  }

  return {
    jsonBody: { ...load, actions: rules.actionsFor(user, load) },
    headers: { 'Cache-Control': 'no-store' },
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/loads/{id}
//
// One route for every change, because a change is often two at once: "put
// Smith on it" is an assignment AND a status change, and doing them as two
// requests would leave a window where the load has a driver and says
// Available. planChange works out the whole next state; this writes it and
// the events that explain it in one transaction.
// ---------------------------------------------------------------------------
async function patchLoad(request, context) {
  const id = request.params.id
  if (!LOAD_ID.test(id)) return notFound()

  const user = await identity.currentUser(request)
  if (!user) return identity.unauthorized('Sign in to change a load.')
  if (user.role === 'none') {
    return identity.forbidden('Your account is waiting for approval before you can change loads.')
  }

  let body
  try {
    body = (await request.json()) || {}
  } catch {
    return badRequest('Expected a JSON body.')
  }

  const pool = await getPool()
  const tx = new sql.Transaction(pool)
  await tx.begin()

  try {
    // UPDLOCK so two dispatchers assigning the same load at the same moment
    // are serialised: the second reads the row the first wrote and plans from
    // that, instead of both planning from Available and both succeeding.
    const current = await new sql.Request(tx)
      .input('id', sql.VarChar(20), id)
      .query(`${FROM_LOADS('WITH (UPDLOCK, HOLDLOCK)')} WHERE l.id = @id;`)

    if (!current.recordset[0]) {
      await tx.rollback()
      return notFound()
    }
    const load = rowToLoad(current.recordset[0])

    const plan = rules.planChange(load, body, user)
    if (plan.errors) {
      await tx.rollback()
      return plan.forbidden ? identity.forbidden(plan.errors.join(' ')) : badRequest(plan.errors)
    }

    const { next, events } = plan

    // Nothing actually changed -- a retried PATCH, or the same status again.
    // Answer with the row as it is rather than writing a no-op and an empty
    // event.
    if (events.length === 0) {
      await tx.rollback()
      return { jsonBody: { ...load, actions: rules.actionsFor(user, load) }, headers: { 'Cache-Control': 'no-store' } }
    }

    if (next.customerId && next.customerId !== load.customerId) {
      const name = await customerName(new sql.Request(tx), next.customerId)
      if (!name) {
        await tx.rollback()
        return badRequest('There is no customer with that id.')
      }
      next.customerName = name
    }

    const req = new sql.Request(tx)
    const fields = {}
    for (const name of Object.keys(rules.FIELDS)) fields[name] = next[name]
    const { assignments } = bindFields(req, fields)

    await req
      .input('id', sql.VarChar(20), id)
      .input('status', sql.NVarChar(20), next.status)
      .input('driverCode', sql.VarChar(20), next.driverCode)
      .input('unitNo', sql.VarChar(20), next.unitNo)
      .input('trailerNo', sql.VarChar(20), next.trailerNo)
      .input('deliveredDate', sql.VarChar(10), next.deliveredDate)
      .input('updatedBy', sql.NVarChar(256), user.email)
      .query(`
        UPDATE dbo.Loads SET
          ${assignments.join(',\n          ')},
          status = @status,
          driver_code = @driverCode,
          unit_no = @unitNo,
          trailer_no = @trailerNo,
          delivered_date = CAST(@deliveredDate AS DATE),
          updated_utc = SYSUTCDATETIME(),
          updated_by = @updatedBy
        WHERE id = @id;
      `)

    for (const event of events) {
      await insertEvent(new sql.Request(tx), load, event, user.email)
    }

    const saved = await selectLoad(new sql.Request(tx), id)
    await tx.commit()

    context.log(`Load ${id} changed by ${user.email}: ${events.map((e) => e.detail || e.type).join('; ')}`)

    return {
      jsonBody: { ...saved, actions: rules.actionsFor(user, saved) },
      headers: { 'Cache-Control': 'no-store' },
    }
  } catch (err) {
    await tx.rollback().catch(() => {})
    throw err
  }
}

// ---------------------------------------------------------------------------
// GET /api/loads/{id}/events
// ---------------------------------------------------------------------------
async function listEvents(request) {
  const id = request.params.id
  if (!LOAD_ID.test(id)) return notFound()

  // History names names, so it follows the same rule as the history itself:
  // an account with a real role, or nothing.
  const user = await identity.currentUser(request)
  if (!user) return identity.unauthorized('Sign in to see a load\'s history.')
  if (!seesEverything(user)) return identity.forbidden('Your account is waiting for approval.')

  const pool = await getPool()
  const result = await pool.request().input('id', sql.VarChar(20), id).query(`
    SELECT event_id, event_utc, actor, event_type, from_status, to_status, driver_code, detail
    FROM dbo.LoadEvents
    WHERE load_id = @id
    ORDER BY event_utc, event_id;
  `)

  return {
    jsonBody: result.recordset.map((r) => ({
      id: r.event_id,
      at: r.event_utc.toISOString(),
      actor: r.actor,
      type: r.event_type,
      fromStatus: r.from_status,
      toStatus: r.to_status,
      driverCode: r.driver_code,
      detail: r.detail,
    })),
    headers: { 'Cache-Control': 'no-store' },
  }
}

// ---------------------------------------------------------------------------
// GET /api/roster
//
// Every driver, and the load they are on if they are on one. This is what a
// dispatcher looks at before assigning: who is free, who is already moving
// and where they will end up. The existing /api/drivers lists only drivers
// who have been paid, because it exists to be clicked through to a statement;
// this lists everyone, because a new hire with no settlement yet is exactly
// who is free.
// ---------------------------------------------------------------------------
async function roster(request) {
  const user = await identity.currentUser(request)
  if (!user) return identity.unauthorized('Sign in to see the roster.')
  if (!identity.can(user, 'editLoad')) return identity.forbidden('Only a dispatcher can see the roster.')

  const pool = await getPool()
  const result = await pool.request().query(`
    SELECT d.driver_code, d.first_name, d.last_name, d.driver_type, d.unit_no, d.truck_description,
           t.status AS truck_status,
           cur.id AS load_id, cur.status AS load_status, cur.destination AS load_destination,
           cur.delivery_end AS load_delivery_end,
           (SELECT COUNT(*) FROM dbo.Loads AS x
             WHERE x.driver_code = d.driver_code AND x.status IN (N'Covered', N'In Transit')) AS open_loads
    FROM dbo.Drivers AS d
    LEFT JOIN dbo.Trucks AS t ON t.unit_no = d.unit_no
    OUTER APPLY (
      SELECT TOP 1 l.id, l.status, l.destination, l.delivery_end
      FROM dbo.Loads AS l
      WHERE l.driver_code = d.driver_code AND l.status IN (N'Covered', N'In Transit')
      ORDER BY CASE l.status WHEN N'In Transit' THEN 0 ELSE 1 END, l.pickup_start, l.id
    ) AS cur
    ORDER BY d.last_name, d.first_name;
  `)

  return {
    jsonBody: result.recordset.map((r) => ({
      driverCode: r.driver_code,
      name: `${r.first_name} ${r.last_name}`,
      driverType: r.driver_type,
      unitNo: r.unit_no,
      truckDescription: r.truck_description,
      // Null when the driver has no regular truck; otherwise Active, Shop or
      // Retired, so the picker can say "truck in shop" beside the name.
      truckStatus: r.truck_status || null,
      openLoads: Number(r.open_loads),
      currentLoad: r.load_id
        ? { id: r.load_id, status: r.load_status, destination: r.load_destination, deliveryEnd: isoDateTime(r.load_delivery_end) }
        : null,
    })),
    headers: { 'Cache-Control': 'no-store' },
  }
}

// ---------------------------------------------------------------------------
// Errors, in one place. A SQL error message can name the server, the database
// and the login, and none of that belongs in a browser -- log the real one,
// return a sentence.
// ---------------------------------------------------------------------------
function wrap(label, handler) {
  return async (request, context) => {
    try {
      return await handler(request, context)
    } catch (err) {
      // A duplicate id is the caller's answer, not a server fault. THROW
      // 50409 and PK_Loads underneath it both land here, so the race between
      // the EXISTS check and the INSERT has the same ending -- two
      // simultaneous posts of one id give one 201 and one 409, never two rows.
      if (err.number === 50409 || err.number === 2627 || err.number === 2601) {
        return { status: 409, jsonBody: { error: 'That load number already exists.' } }
      }
      // 547 is a constraint: a driver code that is not in dbo.Drivers, or a
      // state the lifecycle CHECK refuses. planChange should have caught both
      // in words, so reaching here means the two disagree -- say so plainly
      // rather than pretend the server fell over.
      if (err.number === 547) {
        context.error(`${label} refused by constraint:`, err.message)
        return badRequest(/FK_Loads_driver/.test(err.message)
          ? 'There is no driver with that code.'
          : /FK_Loads_truck/.test(err.message)
            ? 'There is no truck with that unit number.'
            : /FK_Loads_trailer/.test(err.message)
              ? 'There is no trailer with that number.'
              : /FK_Loads_customer/.test(err.message)
                ? 'There is no customer with that id.'
                : 'The database refused that change.')
      }
      context.error(`${label} failed:`, err)
      return { status: 500, jsonBody: { error: 'Could not load data.' } }
    }
  }
}

app.http('loads', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'loads',
  handler: wrap('/api/loads', (request, context) =>
    request.method === 'POST' ? createLoad(request, context) : listLoads(request)),
})

app.http('load', {
  methods: ['GET', 'PATCH'],
  authLevel: 'anonymous',
  route: 'loads/{id}',
  handler: wrap('/api/loads/{id}', (request, context) =>
    request.method === 'PATCH' ? patchLoad(request, context) : getLoad(request)),
})

app.http('loadEvents', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'loads/{id}/events',
  handler: wrap('/api/loads/{id}/events', listEvents),
})

app.http('roster', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'roster',
  handler: wrap('/api/roster', roster),
})
