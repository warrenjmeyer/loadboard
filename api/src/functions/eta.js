const { app } = require('@azure/functions')
const { getPool, sql } = require('../db')
const identity = require('../identity')
const geotab = require('../geotab')
const here = require('../here')
const telematics = require('../telematicsRules')
const rules = require('../etaRules')
const flexpolyline = require('../flexpolyline')
const routeShape = require('../routeShape')

// ---------------------------------------------------------------------------
// What HERE knows about a load: when it gets there, and which roads it takes.
//
//   GET /api/loads/{id}/eta     arrival times for the stops still to come
//   GET /api/loads/{id}/route   the road itself, for the map to draw
//
// Two questions, two routes, because they are asked at different moments and
// answered from different things. An ETA is about a truck that is moving now
// and is worthless an hour later. A lane's ROADS do not change between
// Tuesday and Friday, so that answer is kept for hours and asked for once.
//
// Three systems answer this together and none of them could alone. GeoTab
// says where the truck is now. The app says which stops are left and when
// each dock expects it. HERE turns those into a truck-legal road route and
// hands back an arrival time per leg. This route is the join.
//
// IT COSTS MONEY, which shapes everything below. HERE's free tier is metered
// in transactions, so:
//
//   * nothing polls it -- the browser asks when someone opens a load, and
//     every five minutes after that at most;
//   * the answer is memoised per load, so ten dispatchers watching one load
//     is one transaction, not ten;
//   * etaRules.planEta refuses to ask at all when the answer would be
//     nonsense -- a load nobody is driving, a truck 1,500 miles away, a
//     stop GeoTab has no zone for. Each of those returns 200 with
//     `available: false` and a sentence, because "we are not going to
//     answer that" is a fine answer and not an error.
//
// WHO MAY ASK. Dispatch and admin, and the driver whose load it is. Not
// every role, unlike positions: a position is already on the fleet page,
// while this spends something every time it is asked for.
//
// 503 when either credential is missing -- HERE_API_KEY, or the GEOTAB_*
// settings the position and the zones come from -- the same shape the
// telematics routes use, so the page hides the section rather than showing
// an error to somebody who cannot fix it.
// ---------------------------------------------------------------------------

const LOAD_ID = /^[A-Za-z0-9._-]{1,20}$/

// How long an answer is reused. Five minutes of staleness on a number that
// is a guess about the next several hours is nothing; five minutes of
// transactions saved on a load everyone is watching is real.
//
// Keyed on the load and the stops that are left, deliberately NOT on where
// the truck is: keying on the position would make every GPS report a cache
// miss, which is exactly the meter running.
const MEMO_MS = 5 * 60 * 1000
const memo = new Map()

// A geofence is drawn once and sits there for years; the zone list behind
// the stop coordinates is worth a day, like /api/telematics/zones.
const ZONE_TTL_MS = 24 * 3600 * 1000
let zoneCache = null

function notConfigured(what, settings) {
  return {
    status: 503,
    jsonBody: {
      error: `${what} is not connected on this server. Set ${settings} in the app settings.`,
      configured: false,
    },
    headers: { 'Cache-Control': 'no-store' },
  }
}

function notFound() {
  return { status: 404, jsonBody: { error: 'No such load.' } }
}

async function loadRow(pool, id) {
  const r = await pool.request().input('id', sql.VarChar(20), id).query(`
    SELECT load_number AS id, status, unit_no, driver_code, origin, destination
    FROM dbo.Loads WHERE load_number = @id;
  `)
  const row = r.recordset[0]
  return row ? {
    id: row.id,
    status: row.status,
    unitNo: row.unit_no,
    driverCode: row.driver_code,
    origin: row.origin,
    destination: row.destination,
  } : null
}

// The same columns the stops route serves, and the same naive local
// wall-clock for the windows -- see the time zone note in etaRules.js.
const isoDateTime = (v) => (v ? v.toISOString().slice(0, 19) : null)

async function stopRows(pool, id) {
  const r = await pool.request().input('sid', sql.VarChar(20), id).query(`
    SELECT stop_id, seq, stop_type, place, name, window_start, window_end, arrived_utc, departed_utc
    FROM dbo.LoadStops WHERE load_id = @sid ORDER BY seq;
  `)
  return r.recordset.map((s) => ({
    stopId: s.stop_id,
    seq: Number(s.seq),
    stopType: s.stop_type,
    place: s.place,
    name: s.name,
    windowStart: isoDateTime(s.window_start),
    windowEnd: isoDateTime(s.window_end),
    arrivedUtc: isoDateTime(s.arrived_utc),
    departedUtc: isoDateTime(s.departed_utc),
  }))
}

async function zoneLookup() {
  if (!zoneCache || zoneCache.until <= Date.now()) {
    const raw = await geotab.get('Zone')
    const rows = telematics.zoneRows(raw)
    zoneCache = {
      byKey: new Map(rows.map((z) => [z.key || telematics.zoneKey(z.name), z])),
      until: Date.now() + ZONE_TTL_MS,
    }
  }
  const { byKey } = zoneCache
  return (place) => byKey.get(telematics.zoneKey(place)) || null
}

// This load's driver, and how many hours they have left.
//
// The same join the fleet page uses -- Geotab knows a driver by first and
// last name, this app knows them by code -- and then one DutyStatusAvailability
// read for that one person. Two Geotab calls, no more than the hours page
// makes for twenty-four drivers.
//
// Returns null when anything in the chain is missing: no driver on the load,
// no Geotab user of that name, no availability record. Null means the ETA is
// calculated the way it was yesterday, without hours in it, which is a worse
// answer but an honest one. It is never a guessed clock.
async function hoursFor(pool, driverCode) {
  if (!driverCode) return null

  const result = await pool.request().input('code', sql.VarChar(20), driverCode).query(`
    SELECT driver_code, first_name, last_name, driver_type, unit_no
    FROM dbo.Drivers WHERE driver_code = @code;
  `)
  const row = result.recordset[0]
  if (!row) return null

  const driver = {
    driverCode: row.driver_code,
    firstName: row.first_name,
    lastName: row.last_name,
    driverType: row.driver_type,
    unitNo: row.unit_no,
  }

  const users = await geotab.get('User', { isDriver: true })
  const { byCode } = telematics.matchDrivers(
    (users || []).map((u) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName })),
    [driver],
  )
  const userId = byCode.get(driver.driverCode)
  if (!userId) return null
  driver.geotabUserId = userId

  const availability = await geotab.get('DutyStatusAvailability', { userSearch: { id: userId } })
  const first = Array.isArray(availability) ? availability[0] : availability
  if (!first) return null

  return telematics.hosRow(driver, first, [], new Date())
}

// Where this one truck is. Two calls rather than the whole fleet's worth,
// and matched by name the way everything else in this app matches Geotab:
// Trucks.unit_no is Device.name.
async function positionFor(unitNo) {
  if (!unitNo) return null
  const [devices, statuses] = await geotab.multiCall([
    { method: 'Get', params: { typeName: 'Device' } },
    { method: 'Get', params: { typeName: 'DeviceStatusInfo' } },
  ])
  const rows = telematics.positionRows({
    trucks: [{ unitNo, status: null }],
    devices,
    statuses,
    users: [],
    drivers: [],
  })
  return rows[0] || null
}

// ---------------------------------------------------------------------------
// GET /api/loads/{id}/eta
// ---------------------------------------------------------------------------
async function eta(request) {
  const id = request.params.id
  if (!LOAD_ID.test(id)) return notFound()

  const user = await identity.currentUser(request)
  if (!user) return identity.unauthorized('Sign in to see an ETA.')
  if (user.role === 'none') return identity.forbidden('Your account is waiting for approval.')

  const pool = await getPool()
  const load = await loadRow(pool, id)
  if (!load) return notFound()

  // Dispatch, or the driver this load belongs to. A driver asking about
  // somebody else's freight gets the same 403 as a stranger.
  const isTheirs = Boolean(user.driverCode) && Boolean(load.driverCode)
    && user.driverCode.toUpperCase() === String(load.driverCode).toUpperCase()
  if (!identity.can(user, 'requestEta') && !isTheirs) {
    return identity.forbidden('Only dispatch and the driver on a load can ask for its ETA.')
  }

  if (!here.configured()) return notConfigured('HERE routing', 'HERE_API_KEY')
  if (!geotab.configured()) return notConfigured('GeoTab', 'GEOTAB_DATABASE, GEOTAB_USER and GEOTAB_PASSWORD')

  const stops = await stopRows(pool, id)
  const now = new Date()

  // The cheap refusals first, and only then the two Geotab calls: a
  // Delivered load or one with nothing left to do never touches the network.
  const early = rules.planEta({ load, stops, position: null }, () => null, now)
  if (!early.ask && (early.reason === 'not-moving' || early.reason === 'complete')) {
    return {
      jsonBody: { available: false, reason: early.reason, message: early.message, loadId: load.id },
      headers: { 'Cache-Control': 'no-store' },
    }
  }

  const [position, zoneFor, hos] = await Promise.all([
    positionFor(load.unitNo),
    zoneLookup(),
    hoursFor(pool, load.driverCode),
  ])
  const plan = rules.planEta({ load, stops, position }, zoneFor, now)

  if (!plan.ask) {
    return {
      jsonBody: {
        available: false,
        reason: plan.reason,
        message: plan.message,
        loadId: load.id,
        unitNo: load.unitNo,
        // Where it actually is, in words, when the reason is that it is too
        // far away. The map says the same thing in its caption.
        near: position ? position.near || null : null,
      },
      headers: { 'Cache-Control': 'no-store' },
    }
  }

  // The driver's remaining hours, as a drive/rest schedule HERE can plan
  // around. Part of the cache key: the same load asked about an hour later,
  // with an hour less on the clock, is a different question.
  const schedule = rules.driverSchedule(hos)

  const key = `${load.id}:${plan.stops.map((s) => s.stopId).join(',')}:${schedule || 'no-hours'}`
  const hit = memo.get(key)
  let answer
  if (hit && hit.until > Date.now()) {
    answer = hit.value
  } else {
    const { mode, body, fellBack } = await here.routeThrough(plan.points, { schedule })
    answer = {
      ...rules.readEta(body, plan.stops, { mode }),
      fellBack: Boolean(fellBack),
      askedAt: new Date().toISOString(),
      // What the hours contributed, so the page can say whether the arrival
      // time has sleep in it -- and say when it does not, which matters just
      // as much: an ETA with no hours behind it is a driving time, not an
      // arrival time.
      hours: hos ? {
        driverCode: hos.driverCode,
        driving: hos.driving,
        duty: hos.duty,
        cycle: hos.cycle,
        scheduled: Boolean(schedule),
      } : null,
    }
    memo.set(key, { value: answer, until: Date.now() + MEMO_MS })
    // A cache that only grows is a leak with a long fuse.
    if (memo.size > 500) {
      for (const [k, v] of memo) if (v.until <= Date.now()) memo.delete(k)
    }
  }

  return {
    jsonBody: {
      available: true,
      loadId: load.id,
      unitNo: load.unitNo,
      asOf: now.toISOString(),
      from: {
        latitude: position.latitude,
        longitude: position.longitude,
        near: position.near || null,
        reportedUtc: position.dateTime,
        ageMinutes: position.ageMinutes,
      },
      ...answer,
    },
    headers: { 'Cache-Control': 'no-store' },
  }
}

// ---------------------------------------------------------------------------
// GET /api/loads/{id}/route
//
// The road through this load's stops, so the map can draw what the truck
// actually drives instead of a straight line between towns. Every stop, in
// order -- not just the ones still to come, because this draws the whole
// lane and not the remainder of a journey.
//
// Kept for six hours. The geometry of a road between two towns is the same
// this afternoon as it was this morning, and each ask is a transaction.
// ---------------------------------------------------------------------------
const ROUTE_MEMO_MS = 6 * 3600 * 1000
const routeMemo = new Map()

async function laneRoute(request) {
  const id = request.params.id
  if (!LOAD_ID.test(id)) return notFound()

  const user = await identity.currentUser(request)
  if (!user) return identity.unauthorized('Sign in to see the map.')
  if (user.role === 'none') return identity.forbidden('Your account is waiting for approval.')

  const pool = await getPool()
  const load = await loadRow(pool, id)
  if (!load) return notFound()

  if (!here.configured()) return notConfigured('HERE routing', 'HERE_API_KEY')
  if (!geotab.configured()) return notConfigured('GeoTab', 'GEOTAB_DATABASE, GEOTAB_USER and GEOTAB_PASSWORD')

  const stops = await stopRows(pool, id)
  if (stops.length < 2) {
    return {
      jsonBody: { available: false, reason: 'one-stop', message: 'A load with one stop has no lane to draw.' },
      headers: { 'Cache-Control': 'no-store' },
    }
  }

  // The same name join the map and the ETA use: a stop's town is a Geotab
  // zone of that name. A stop nobody has drawn a box around has no
  // coordinate, and a road drawn through the stops either side of it would
  // be a different lane wearing this one's name.
  const zoneFor = await zoneLookup()
  const points = []
  const unknown = []
  for (const stop of stops) {
    const zone = zoneFor(stop.place)
    if (zone && Number.isFinite(Number(zone.latitude))) {
      points.push({ latitude: Number(zone.latitude), longitude: Number(zone.longitude) })
    } else {
      unknown.push(stop.place)
    }
  }
  if (unknown.length > 0) {
    return {
      jsonBody: {
        available: false,
        reason: 'no-places',
        message: `GeoTab has no zone for ${unknown.join(', ')}, so the road cannot be drawn.`,
      },
      headers: { 'Cache-Control': 'no-store' },
    }
  }

  const key = `${load.id}:${stops.map((s) => `${s.stopId}@${s.place}`).join('|')}`
  const hit = routeMemo.get(key)
  if (hit && hit.until > Date.now()) {
    return { jsonBody: hit.value, headers: { 'Cache-Control': 'private, max-age=3600' } }
  }

  const { mode, body, fellBack } = await here.routeThrough(points, { geometry: true })
  const sections = (body && body.routes && body.routes[0] && body.routes[0].sections) || []

  let miles = 0
  let seconds = 0
  const legs = sections.map((section, i) => {
    const summary = section.summary || {}
    const legMiles = Math.round((Number(summary.length) || 0) / 1609.344)
    miles += legMiles
    seconds += Number(summary.duration) || 0
    // Decoded here and thinned here, so the browser receives plain numbers
    // and a few hundred of them rather than a few thousand and a decoder.
    const shape = routeShape.round(routeShape.simplify(flexpolyline.decode(section.polyline)))
    return {
      from: stops[i] ? stops[i].seq : null,
      to: stops[i + 1] ? stops[i + 1].seq : null,
      miles: legMiles,
      seconds: Number(summary.duration) || 0,
      points: shape,
    }
  })

  const answer = {
    available: true,
    loadId: load.id,
    mode,
    fellBack: Boolean(fellBack),
    legs,
    miles,
    seconds,
    points: legs.reduce((total, leg) => total + leg.points.length, 0),
  }
  routeMemo.set(key, { value: answer, until: Date.now() + ROUTE_MEMO_MS })
  if (routeMemo.size > 200) {
    for (const [k, v] of routeMemo) if (v.until <= Date.now()) routeMemo.delete(k)
  }

  return { jsonBody: answer, headers: { 'Cache-Control': 'private, max-age=3600' } }
}

// ---------------------------------------------------------------------------
function wrap(label, handler) {
  return async (request, context) => {
    try {
      return await handler(request, context)
    } catch (err) {
      if (err instanceof here.HereError) {
        // HERE's own wording is fit to show an admin -- "Invalid credentials"
        // names what to fix -- and names nothing secret. The key rides in the
        // query string, so the URL is deliberately not in this message.
        context.error(`${label} refused by HERE:`, err.message)
        return {
          status: 502,
          jsonBody: { error: `Could not get a route from HERE. ${err.detail}.`, configured: true },
          headers: { 'Cache-Control': 'no-store' },
        }
      }
      if (err instanceof geotab.GeotabError) {
        context.error(`${label} refused by Geotab:`, err.message)
        geotab.forget()
        return {
          status: 502,
          jsonBody: { error: `Could not read from GeoTab. ${err.message}.`, configured: true },
          headers: { 'Cache-Control': 'no-store' },
        }
      }
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        context.error(`${label} timed out`)
        return {
          status: 504,
          jsonBody: { error: 'The routing service did not answer in time.', configured: true },
          headers: { 'Cache-Control': 'no-store' },
        }
      }
      context.error(`${label} failed:`, err)
      return { status: 500, jsonBody: { error: 'Could not work out an ETA.' } }
    }
  }
}

app.http('load-eta', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'loads/{id}/eta',
  handler: wrap('/api/loads/{id}/eta', eta),
})

app.http('load-route', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'loads/{id}/route',
  handler: wrap('/api/loads/{id}/route', laneRoute),
})
