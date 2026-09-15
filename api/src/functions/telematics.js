const { app } = require('@azure/functions')
const { getPool, sql } = require('../db')
const identity = require('../identity')
const geotab = require('../geotab')
const rules = require('../telematicsRules')

// ---------------------------------------------------------------------------
// What the trucks are doing, read from MyGeotab.
//
//   GET /api/telematics/positions            every truck: where, how fast,
//                                            who is in it, how old the report
//   GET /api/telematics/positions?unit=X     one truck
//   GET /api/telematics/hours                every driver's HOS clocks
//   GET /api/telematics/hours?driver=CODE    one driver's
//   GET /api/telematics/zones                the named places, with centres,
//                                            so a stop can go on a map
//
// READS ONLY. Nothing here changes anything in Geotab, and nothing here is
// stored: every answer is fetched when asked for and handed straight back.
// Geotab is the system of record for where a truck is and how many hours a
// driver has; this app is the system of record for what the truck is hauling.
// The join between the two is by name, in telematicsRules.js.
//
// Who may see what follows the rest of the app:
//
//   positions   anyone with a role, like the fleet page it appears on
//   hours       dispatch and admin for everyone; a driver for themselves.
//               Hours are a compliance record about a person, which is the
//               same standing as a settlement, so canViewDriver decides.
//
// When GeoTab is not configured -- the three GEOTAB_* settings are absent
// from the Function App -- the routes answer 503 with a sentence saying so.
// The pages treat that as "no telematics here", not as an error, so the
// app works without a Geotab account; it just has less to say.
// ---------------------------------------------------------------------------

// A Geotab answer is reused for this long. Five dispatchers with the fleet
// page open should make one round trip to Geotab, not five.
const MEMO_MS = 20000
const memo = new Map()

async function remember(key, fn) {
  const hit = memo.get(key)
  if (hit && hit.until > Date.now()) return hit.value
  const value = await fn()
  memo.set(key, { value, until: Date.now() + MEMO_MS })
  return value
}

function notConfigured() {
  return {
    status: 503,
    jsonBody: {
      error: 'GeoTab is not connected on this server. Set GEOTAB_DATABASE, GEOTAB_USER and GEOTAB_PASSWORD in the app settings.',
      configured: false,
    },
    headers: { 'Cache-Control': 'no-store' },
  }
}

// The fleet as the app knows it. Same joins as /api/trucks, fewer columns:
// this is the list Geotab annotates, so the rows exist even when Geotab
// has nothing to say about them.
async function appTrucks(pool) {
  const result = await pool.request().query(`
    SELECT t.unit_no, t.status,
           d.driver_code, d.first_name, d.last_name,
           cur.id AS load_id, cur.status AS load_status, cur.destination AS load_destination
    FROM dbo.Trucks AS t
    LEFT JOIN dbo.Drivers AS d ON d.unit_no = t.unit_no
    OUTER APPLY (
      SELECT TOP 1 l.id, l.status, l.destination
      FROM dbo.Loads AS l
      WHERE l.unit_no = t.unit_no AND l.status IN (N'Covered', N'In Transit')
      ORDER BY CASE l.status WHEN N'In Transit' THEN 0 ELSE 1 END, l.pickup_start, l.id
    ) AS cur
    WHERE t.status <> N'Retired';
  `)
  return result.recordset.map((r) => ({
    unitNo: r.unit_no,
    status: r.status,
    regularDriver: r.driver_code ? { driverCode: r.driver_code, name: `${r.first_name} ${r.last_name}` } : null,
    currentLoad: r.load_id ? { id: r.load_id, status: r.load_status, destination: r.load_destination } : null,
  }))
}

async function appDrivers(pool, driverCode) {
  const req = pool.request()
  let where = ''
  if (driverCode) {
    req.input('code', sql.VarChar(20), driverCode)
    where = 'WHERE d.driver_code = @code'
  }
  const result = await req.query(`
    SELECT d.driver_code, d.first_name, d.last_name, d.driver_type, d.unit_no
    FROM dbo.Drivers AS d ${where}
    ORDER BY d.last_name, d.first_name;
  `)
  return result.recordset.map((r) => ({
    driverCode: r.driver_code,
    firstName: r.first_name,
    lastName: r.last_name,
    driverType: r.driver_type,
    unitNo: r.unit_no,
  }))
}

// Geotab's users who are drivers. Only the fields the join needs leave
// this function; a Geotab User carries an email and a phone number, and
// neither is anyone's business here.
async function geotabDrivers() {
  return remember('users', async () => {
    const users = await geotab.get('User', { isDriver: true })
    return (users || []).map((u) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName }))
  })
}

// ---------------------------------------------------------------------------
// Where each position is, in words: "Ankeny, IA" beside the coordinates.
//
// Geotab's own reverse geocoding, one API call for every truck at once, and
// a cache keyed on the position rounded to about a hundred metres, kept
// for a day. Twenty demo trucks circling the same town all day ask a few
// dozen times, not a few thousand. A geocode that fails leaves the row
// with coordinates only; the position is the fact, the name is a comfort.
// ---------------------------------------------------------------------------
const PLACE_TTL_MS = 24 * 3600 * 1000
const places = new Map()

async function addPlaceNames(rows) {
  const want = []
  for (const r of rows) {
    r.near = null
    const key = rules.placeKey(r.latitude, r.longitude)
    if (!key) continue
    const hit = places.get(key)
    if (hit && hit.until > Date.now()) r.near = hit.near
    else if (!want.some((w) => w.key === key)) want.push({ key, latitude: r.latitude, longitude: r.longitude })
  }
  if (want.length === 0) return
  let answers
  try {
    answers = await geotab.getAddresses(want)
  } catch {
    return
  }
  want.forEach((w, i) => {
    const near = rules.nearFrom(answers && answers[i])
    places.set(w.key, { near, until: Date.now() + PLACE_TTL_MS })
  })
  for (const r of rows) {
    if (r.near === null) {
      const hit = places.get(rules.placeKey(r.latitude, r.longitude))
      if (hit) r.near = hit.near
    }
  }
  // A cache that only grows is a leak with a long fuse.
  if (places.size > 5000) {
    for (const [k, v] of places) if (v.until <= Date.now()) places.delete(k)
  }
}

// ---------------------------------------------------------------------------
// GET /api/telematics/positions
// ---------------------------------------------------------------------------
async function positions(request) {
  const user = await identity.currentUser(request)
  if (!user) return identity.unauthorized('Sign in to see where the trucks are.')
  if (user.role === 'none') return identity.forbidden('Your account is waiting for approval.')
  if (!geotab.configured()) return notConfigured()

  const pool = await getPool()
  const [trucks, drivers, users, fleet] = await Promise.all([
    appTrucks(pool),
    appDrivers(pool),
    geotabDrivers(),
    remember('fleet', async () => {
      const [devices, statuses] = await geotab.multiCall([
        { method: 'Get', params: { typeName: 'Device' } },
        { method: 'Get', params: { typeName: 'DeviceStatusInfo' } },
      ])
      return {
        devices: (devices || []).map((d) => ({ id: d.id, name: d.name })),
        statuses: statuses || [],
      }
    }),
  ])

  const now = new Date()
  let rows = rules.positionRows({ trucks, devices: fleet.devices, statuses: fleet.statuses, users, drivers }, now)
  await addPlaceNames(rows)

  const unit = (request.query.get('unit') || '').trim()
  if (unit) {
    rows = rows.filter((r) => r.unitNo.toUpperCase() === unit.toUpperCase())
    if (rows.length === 0) return { status: 404, jsonBody: { error: 'No such truck.' } }
  }

  return {
    jsonBody: { asOf: now.toISOString(), database: geotab.settings().database, trucks: rows },
    headers: { 'Cache-Control': 'no-store' },
  }
}

// ---------------------------------------------------------------------------
// GET /api/telematics/zones
//
// The places this fleet goes, as named polygons in Geotab, reduced to a name
// and a centre. It is what lets the load map put a stop on the page without
// geocoding anything: the stop says "Waterloo, IA" and so does the zone.
//
// Kept for a day rather than twenty seconds. A geofence is drawn once and
// then sits there for years; re-reading it every time somebody opens a load
// would spend the Geotab quota on a list that never changes.
//
// Same audience as positions -- anyone with a role. A zone list is where the
// carrier's customers are, which is commercial but not personal, and every
// name in it is already printed on the load board.
// ---------------------------------------------------------------------------
const ZONE_TTL_MS = 24 * 3600 * 1000
let zoneCache = null

async function zones(request) {
  const user = await identity.currentUser(request)
  if (!user) return identity.unauthorized('Sign in to see the map.')
  if (user.role === 'none') return identity.forbidden('Your account is waiting for approval.')
  if (!geotab.configured()) return notConfigured()

  if (!zoneCache || zoneCache.until <= Date.now()) {
    const raw = await geotab.get('Zone')
    zoneCache = { rows: rules.zoneRows(raw), until: Date.now() + ZONE_TTL_MS }
  }

  return {
    jsonBody: { database: geotab.settings().database, zones: zoneCache.rows },
    // A day in Geotab, a minute in the browser: the page asks again on a
    // reload, and gets the Function's copy without troubling Geotab.
    headers: { 'Cache-Control': 'private, max-age=60' },
  }
}

// ---------------------------------------------------------------------------
// GET /api/telematics/hours
// ---------------------------------------------------------------------------
async function hours(request) {
  const user = await identity.currentUser(request)
  if (!user) return identity.unauthorized('Sign in to see hours of service.')
  if (user.role === 'none') return identity.forbidden('Your account is waiting for approval.')

  const driverCode = (request.query.get('driver') || '').trim().toUpperCase() || null
  if (driverCode) {
    if (!identity.canViewDriver(user, driverCode)) return identity.forbidden('Those are not your hours to see.')
  } else if (!identity.can(user, 'viewAllHours')) {
    return identity.forbidden('Only a dispatcher can see every driver\'s hours.')
  }
  if (!geotab.configured()) return notConfigured()

  const pool = await getPool()
  const [drivers, users] = await Promise.all([appDrivers(pool, driverCode), geotabDrivers()])
  if (driverCode && drivers.length === 0) return { status: 404, jsonBody: { error: 'No such driver.' } }

  const { byCode, unmatched } = rules.matchDrivers(users, drivers)
  for (const d of drivers) d.geotabUserId = byCode.get(d.driverCode) || null

  const now = new Date()
  const key = driverCode ? `hours:${driverCode}` : 'hours'
  const answers = await remember(key, async () => {
    // Two calls per matched driver, in one round trip: the clocks, and the
    // last day and a half of duty logs to read the current status from.
    // includeBoundaryLogs adds the entry in force at fromDate, so a driver
    // who went off duty two days ago and stayed there still has a status.
    const matched = drivers.filter((d) => d.geotabUserId)
    const fromDate = new Date(now.getTime() - 36 * 3600 * 1000).toISOString()
    const calls = []
    for (const d of matched) {
      calls.push({ method: 'Get', params: { typeName: 'DutyStatusAvailability', search: { userSearch: { id: d.geotabUserId } } } })
      calls.push({ method: 'Get', params: {
        typeName: 'DutyStatusLog',
        search: { userSearch: { id: d.geotabUserId }, fromDate, toDate: now.toISOString(), includeBoundaryLogs: true },
      } })
    }
    const results = await geotab.multiCall(calls)
    const byUser = new Map()
    matched.forEach((d, i) => {
      const availability = results[i * 2]
      const logs = results[i * 2 + 1]
      byUser.set(d.geotabUserId, {
        availability: Array.isArray(availability) ? availability[0] || null : availability || null,
        logs: Array.isArray(logs) ? logs.map((l) => ({ status: l.status, dateTime: l.dateTime })) : [],
      })
    })
    return byUser
  })

  const rows = drivers
    .map((d) => {
      const a = d.geotabUserId ? answers.get(d.geotabUserId) : null
      return rules.hosRow(d, a ? a.availability : null, a ? a.logs : [], now)
    })
    .sort((x, y) => {
      // Who is nearest to running out first. Unknown clocks go last.
      const tx = rules.tightestClock(x)
      const ty = rules.tightestClock(y)
      if (!tx && !ty) return x.name.localeCompare(y.name)
      if (!tx) return 1
      if (!ty) return -1
      return tx.seconds - ty.seconds
    })

  return {
    jsonBody: { asOf: now.toISOString(), database: geotab.settings().database, drivers: rows, unmatched },
    headers: { 'Cache-Control': 'no-store' },
  }
}

// ---------------------------------------------------------------------------
function wrap(label, handler) {
  return async (request, context) => {
    try {
      return await handler(request, context)
    } catch (err) {
      if (err instanceof geotab.GeotabError) {
        // Geotab's own message is fit to show: "Incorrect login credentials"
        // tells the admin exactly what to fix, and it names nothing secret.
        context.error(`${label} refused by Geotab:`, err.message)
        geotab.forget()
        return { status: 502, jsonBody: { error: `Could not read from GeoTab. ${err.message}.`, configured: true }, headers: { 'Cache-Control': 'no-store' } }
      }
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        context.error(`${label} timed out talking to Geotab`)
        return { status: 504, jsonBody: { error: 'GeoTab did not answer in time.', configured: true }, headers: { 'Cache-Control': 'no-store' } }
      }
      context.error(`${label} failed:`, err)
      return { status: 500, jsonBody: { error: 'Could not load data.' } }
    }
  }
}

app.http('telematics-positions', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'telematics/positions',
  handler: wrap('/api/telematics/positions', positions),
})

app.http('telematics-hours', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'telematics/hours',
  handler: wrap('/api/telematics/hours', hours),
})

app.http('telematics-zones', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'telematics/zones',
  handler: wrap('/api/telematics/zones', zones),
})
