const { app } = require('@azure/functions')
const { getPool, sql } = require('../db')
const identity = require('../identity')
const rules = require('../stopRules')
const loadRules = require('../loadRules')

// ---------------------------------------------------------------------------
// A load's stops.
//
//   GET  /api/loads/{id}/stops          the itinerary, in order. Visible to
//                                       whoever can see the load: a real
//                                       role sees everything; an anonymous
//                                       visitor sees where and when on a
//                                       current load, and nothing on a
//                                       delivered one
//   PUT  /api/loads/{id}/stops          replace the itinerary (dispatch).
//                                       The load's six summary columns are
//                                       rewritten from it in the same
//                                       transaction
//   POST /api/stops/{stopId}/checkin    { action: 'arrive' | 'depart' } --
//                                       the driver on the load, or dispatch
//
// Stops are replaced as a list rather than edited one at a time, because
// the order IS the itinerary and reordering by PATCHing seq numbers one by
// one would pass through states where two stops are both third. Stops that
// arrive with a stopId keep their check-in times; the rest are new.
// ---------------------------------------------------------------------------

const LOAD_ID = /^[A-Za-z0-9._-]{1,20}$/
const isoDateTime = (v) => (v ? v.toISOString().slice(0, 19) : null)

function badRequest(errors) {
  return { status: 400, jsonBody: { error: Array.isArray(errors) ? errors.join(' ') : errors } }
}

function notFound() {
  return { status: 404, jsonBody: { error: 'That load is not on the board.' } }
}

function stopRow(r) {
  return {
    stopId: r.stop_id,
    seq: Number(r.seq),
    stopType: r.stop_type,
    place: r.place,
    name: r.name,
    address: r.address,
    phone: r.phone,
    windowStart: isoDateTime(r.window_start),
    windowEnd: isoDateTime(r.window_end),
    referenceNo: r.reference_no,
    notes: r.notes,
    arrivedUtc: isoDateTime(r.arrived_utc),
    departedUtc: isoDateTime(r.departed_utc),
  }
}

async function loadFor(req, id, lock = '') {
  const r = await req.input('id', sql.VarChar(20), id).query(`
    SELECT load_number AS id, status, driver_code, origin, destination FROM dbo.Loads ${lock} WHERE load_number = @id;
  `)
  const row = r.recordset[0]
  return row ? { id: row.id, status: row.status, driverCode: row.driver_code, origin: row.origin, destination: row.destination } : null
}

async function stopsFor(req, id) {
  const r = await req.input('sid', sql.VarChar(20), id).query(`
    SELECT stop_id, seq, stop_type, place, name, address, phone, window_start, window_end, reference_no, notes, arrived_utc, departed_utc
    FROM dbo.LoadStops WHERE load_id = @sid ORDER BY seq;
  `)
  return r.recordset.map(stopRow)
}

function seesEverything(user) {
  return Boolean(user) && user.role !== 'none'
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
async function list(request) {
  const id = request.params.id
  if (!LOAD_ID.test(id)) return notFound()
  const user = await identity.currentUser(request)
  const pool = await getPool()
  const load = await loadFor(pool.request(), id)
  if (!load) return notFound()
  if (!seesEverything(user) && !loadRules.PUBLIC_STATUSES.has(load.status)) return notFound()

  const stops = await stopsFor(pool.request(), id)
  const visible = seesEverything(user) ? stops : stops.map(rules.publicStop)
  return {
    jsonBody: { loadId: id, stops: visible, progress: seesEverything(user) ? rules.progress(stops) : null },
    headers: { 'Cache-Control': 'no-store' },
  }
}

// ---------------------------------------------------------------------------
// PUT: replace the itinerary
// ---------------------------------------------------------------------------
async function replace(request, context) {
  const id = request.params.id
  if (!LOAD_ID.test(id)) return notFound()
  const user = await identity.currentUser(request)
  if (!user) return identity.unauthorized('Sign in to change a load.')
  if (!identity.can(user, 'editLoad')) return identity.forbidden('Only a dispatcher can change a load\'s stops.')

  let body
  try {
    body = await request.json()
  } catch {
    return badRequest('Expected a JSON body.')
  }
  const raw = Array.isArray(body) ? body : body && body.stops
  const { errors, stops } = rules.validateStops(raw)
  if (errors.length) return badRequest(errors)

  const pool = await getPool()
  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    const load = await loadFor(new sql.Request(tx), id, 'WITH (UPDLOCK, HOLDLOCK)')
    if (!load) {
      await tx.rollback()
      return notFound()
    }
    if (load.status === 'Delivered' || load.status === 'Cancelled') {
      await tx.rollback()
      return badRequest(`A ${load.status.toLowerCase()} load's stops cannot be changed. Move it back first.`)
    }
    const existing = await stopsFor(new sql.Request(tx), id)
    const keep = new Map(existing.map((s) => [s.stopId, s]))

    // A departed stop is history and cannot be dropped or moved out of
    // sequence; it can be edited (a corrected phone number) in place.
    const departedIds = existing.filter((s) => s.departedUtc).map((s) => s.stopId)
    const incomingIds = stops.map((s) => s.stopId)
    for (const dId of departedIds) {
      if (!incomingIds.includes(dId)) {
        await tx.rollback()
        return badRequest(`Stop ${keep.get(dId).seq} (${keep.get(dId).place}) has been departed and cannot be removed.`)
      }
    }
    for (let i = 0; i < stops.length; i++) {
      const s = stops[i]
      if (s.stopId && !keep.has(s.stopId)) {
        await tx.rollback()
        return badRequest(`Stop ${i + 1} refers to a stop that is not on this load.`)
      }
    }
    // Departed stops must still come first, in their old order.
    const departedInOrder = stops.filter((s) => s.stopId && keep.get(s.stopId).departedUtc).map((s) => s.stopId)
    const departedExpected = existing.filter((s) => s.departedUtc).map((s) => s.stopId)
    if (departedInOrder.join() !== departedExpected.join() || stops.slice(0, departedExpected.length).some((s) => !s.stopId || !keep.get(s.stopId).departedUtc)) {
      await tx.rollback()
      return badRequest('Stops already departed have to stay first, in the order they were driven.')
    }

    // Two passes so the unique (load_id, seq) never collides mid-way: park
    // the survivors out of the way, then write the list. Parked ABOVE the
    // range rather than negated: CK_LoadStops_seq insists on seq >= 1, and
    // a negative parking spot was the first thing it refused.
    await new sql.Request(tx).input('id', sql.VarChar(20), id).query('UPDATE dbo.LoadStops SET seq = seq + 1000 WHERE load_id = @id;')
    const keptIds = new Set(stops.map((s) => s.stopId).filter(Boolean))
    for (const s of existing) {
      if (!keptIds.has(s.stopId)) {
        // Paper attached to a removed stop stays on the load, unlabelled by
        // stop. FK_Documents_stop has no cascade (see documents_01_ddl.sql),
        // so this has to happen here, first.
        await new sql.Request(tx).input('sid', sql.Int, s.stopId).query(`
          IF OBJECT_ID(N'dbo.LoadDocuments', N'U') IS NOT NULL
            UPDATE dbo.LoadDocuments SET stop_id = NULL WHERE stop_id = @sid;
          DELETE FROM dbo.LoadStops WHERE stop_id = @sid;
        `)
      }
    }
    for (const s of stops) {
      const req = new sql.Request(tx)
        .input('id', sql.VarChar(20), id)
        .input('seq', sql.SmallInt, s.seq)
        .input('type', sql.VarChar(10), s.stopType)
        .input('place', sql.NVarChar(100), s.place)
        .input('name', sql.NVarChar(100), s.name)
        .input('address', sql.NVarChar(200), s.address)
        .input('phone', sql.VarChar(30), s.phone)
        .input('ws', sql.VarChar(19), s.windowStart)
        .input('we', sql.VarChar(19), s.windowEnd)
        .input('ref', sql.NVarChar(40), s.referenceNo)
        .input('notes', sql.NVarChar(400), s.notes)
      if (s.stopId) {
        await req.input('sid', sql.Int, s.stopId).query(`
          UPDATE dbo.LoadStops SET seq = @seq, stop_type = @type, place = @place, name = @name, address = @address, phone = @phone,
                 window_start = CAST(@ws AS DATETIME2(0)), window_end = CAST(@we AS DATETIME2(0)), reference_no = @ref, notes = @notes
           WHERE stop_id = @sid AND load_id = @id;
        `)
      } else {
        await req.query(`
          INSERT INTO dbo.LoadStops (load_id, seq, stop_type, place, name, address, phone, window_start, window_end, reference_no, notes)
          VALUES (@id, @seq, @type, @place, @name, @address, @phone, CAST(@ws AS DATETIME2(0)), CAST(@we AS DATETIME2(0)), @ref, @notes);
        `)
      }
    }

    // The headline: the six summary columns, from the first and last stop.
    const sum = rules.summaryFrom(stops)
    await new sql.Request(tx)
      .input('id', sql.VarChar(20), id)
      .input('origin', sql.NVarChar(100), sum.origin)
      .input('destination', sql.NVarChar(100), sum.destination)
      .input('sn', sql.NVarChar(100), sum.shipperName).input('sa', sql.NVarChar(200), sum.shipperAddress).input('sp', sql.VarChar(30), sum.shipperPhone)
      .input('cn', sql.NVarChar(100), sum.consigneeName).input('ca', sql.NVarChar(200), sum.consigneeAddress).input('cp', sql.VarChar(30), sum.consigneePhone)
      .input('ps', sql.VarChar(19), sum.pickupStart).input('pe', sql.VarChar(19), sum.pickupEnd)
      .input('ds', sql.VarChar(19), sum.deliveryStart).input('de', sql.VarChar(19), sum.deliveryEnd)
      .input('by', sql.NVarChar(256), user.email)
      .input('detail', sql.NVarChar(400), `Changed stops: ${stops.length} stops, ${stops.map((s) => s.place).join(' → ')}`.slice(0, 400))
      .query(`
        UPDATE dbo.Loads SET origin = @origin, destination = @destination,
               shipper_name = @sn, shipper_address = @sa, shipper_phone = @sp,
               consignee_name = @cn, consignee_address = @ca, consignee_phone = @cp,
               pickup_start = CAST(@ps AS DATETIME2(0)), pickup_end = CAST(@pe AS DATETIME2(0)),
               delivery_start = CAST(@ds AS DATETIME2(0)), delivery_end = CAST(@de AS DATETIME2(0)),
               updated_utc = SYSUTCDATETIME(), updated_by = @by
         WHERE load_number = @id;
        INSERT INTO dbo.LoadEvents (load_id, actor, event_type, detail) VALUES (@id, @by, 'Edited', @detail);
      `)

    const saved = await stopsFor(new sql.Request(tx), id)
    await tx.commit()
    context.log(`Load ${id} stops replaced by ${user.email}: ${saved.length} stops`)
    return { jsonBody: { loadId: id, stops: saved, progress: rules.progress(saved) }, headers: { 'Cache-Control': 'no-store' } }
  } catch (err) {
    await tx.rollback().catch(() => {})
    throw err
  }
}

// ---------------------------------------------------------------------------
// POST /api/stops/{stopId}/checkin
// ---------------------------------------------------------------------------
async function checkIn(request, context) {
  const stopId = Number(request.params.stopId)
  if (!Number.isInteger(stopId) || stopId <= 0) return { status: 404, jsonBody: { error: 'No such stop.' } }
  const user = await identity.currentUser(request)
  if (!user) return identity.unauthorized('Sign in to check in.')
  if (user.role === 'none') return identity.forbidden('Your account is waiting for approval.')

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
    const owner = await new sql.Request(tx).input('sid', sql.Int, stopId).query('SELECT load_id FROM dbo.LoadStops WHERE stop_id = @sid;')
    if (!owner.recordset[0]) {
      await tx.rollback()
      return { status: 404, jsonBody: { error: 'No such stop.' } }
    }
    const loadId = owner.recordset[0].load_id
    const load = await loadFor(new sql.Request(tx), loadId, 'WITH (UPDLOCK, HOLDLOCK)')
    const stops = await stopsFor(new sql.Request(tx), loadId)

    const plan = rules.planCheckIn(load, stops, stopId, body.action, user)
    if (plan.errors.length) {
      await tx.rollback()
      if (plan.forbidden) return identity.forbidden(plan.errors.join(' '))
      if (plan.notFound) return { status: 404, jsonBody: { error: plan.errors.join(' ') } }
      return badRequest(plan.errors)
    }

    await new sql.Request(tx)
      .input('sid', sql.Int, stopId)
      .input('arrived', sql.VarChar(19), plan.stop.arrivedUtc)
      .input('departed', sql.VarChar(19), plan.stop.departedUtc)
      .query('UPDATE dbo.LoadStops SET arrived_utc = CAST(@arrived AS DATETIME2(0)), departed_utc = CAST(@departed AS DATETIME2(0)) WHERE stop_id = @sid;')
    if (plan.loadStatus !== load.status) {
      await new sql.Request(tx).input('id', sql.VarChar(20), loadId).input('status', sql.NVarChar(20), plan.loadStatus).input('by', sql.NVarChar(256), user.email)
        .query('UPDATE dbo.Loads SET status = @status, updated_utc = SYSUTCDATETIME(), updated_by = @by WHERE load_number = @id;')
    }
    for (const ev of plan.events) {
      await new sql.Request(tx)
        .input('id', sql.VarChar(20), loadId).input('by', sql.NVarChar(256), user.email)
        .input('type', sql.VarChar(20), ev.type).input('from', sql.NVarChar(20), ev.fromStatus || null).input('to', sql.NVarChar(20), ev.toStatus || null)
        .input('detail', sql.NVarChar(400), ev.detail || null)
        .query('INSERT INTO dbo.LoadEvents (load_id, actor, event_type, from_status, to_status, detail) VALUES (@id, @by, @type, @from, @to, @detail);')
    }
    const saved = await stopsFor(new sql.Request(tx), loadId)
    await tx.commit()
    context.log(`Stop ${stopId} on ${loadId}: ${body.action} by ${user.email}`)
    return { jsonBody: { loadId, stops: saved, progress: rules.progress(saved), loadStatus: plan.loadStatus }, headers: { 'Cache-Control': 'no-store' } }
  } catch (err) {
    await tx.rollback().catch(() => {})
    throw err
  }
}

function wrap(label, handler) {
  return async (request, context) => {
    try {
      return await handler(request, context)
    } catch (err) {
      if (err.number === 547) {
        context.error(`${label} refused by constraint:`, err.message)
        return badRequest('The database refused that change.')
      }
      context.error(`${label} failed:`, err)
      return { status: 500, jsonBody: { error: 'Could not load data.' } }
    }
  }
}

app.http('loadStops', {
  methods: ['GET', 'PUT'],
  authLevel: 'anonymous',
  route: 'loads/{id}/stops',
  handler: wrap('/api/loads/{id}/stops', (request, context) =>
    request.method === 'PUT' ? replace(request, context) : list(request)),
})

app.http('stopCheckIn', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'stops/{stopId}/checkin',
  handler: wrap('/api/stops/{stopId}/checkin', checkIn),
})
