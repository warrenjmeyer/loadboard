const { app } = require('@azure/functions')
const { getPool, sql } = require('../db')
const identity = require('../identity')
const geotab = require('../geotab')
const here = require('../here')
const telematics = require('../telematicsRules')
const rules = require('../etaRules')

// ---------------------------------------------------------------------------
// When this load gets to each stop it has left.
//
//   GET /api/loads/{id}/eta
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
    SELECT id, status, unit_no, driver_code, origin, destination
    FROM dbo.Loads WHERE id = @id;
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

  const [position, zoneFor] = await Promise.all([positionFor(load.unitNo), zoneLookup()])
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

  const key = `${load.id}:${plan.stops.map((s) => s.stopId).join(',')}`
  const hit = memo.get(key)
  let answer
  if (hit && hit.until > Date.now()) {
    answer = hit.value
  } else {
    const { mode, body, fellBack } = await here.routeThrough(plan.points)
    answer = {
      ...rules.readEta(body, plan.stops, { mode }),
      fellBack: Boolean(fellBack),
      askedAt: new Date().toISOString(),
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
