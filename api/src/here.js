// ---------------------------------------------------------------------------
// HERE Routing v8, from the server.
//
// WHY A THIRD PARTY AT ALL, in an app that has gone out of its way not to
// need one. The map draws lanes as the crow flies and says so, because a
// straight line is honest about knowing nothing. An ETA cannot be honest
// that way: "when does this truck get to the dock" is a road question, and
// answering it needs a road network with truck restrictions on it -- bridge
// heights, weight limits, roads a 53-foot trailer may not turn into. HERE
// has that. The free routers do not: OSRM, Valhalla and OpenRouteService
// all route a car and call it close enough, which on a lane with a low
// bridge is not close enough at all.
//
// Measured on this fleet's own lane the difference is not academic. Dubuque
// to Minneapolis is 263 miles as a car and 312 as a truck -- a 49-mile
// detour onto roads the trailer is allowed on. A car ETA would have been
// three quarters of an hour early, every time, and looked authoritative.
//
// THE KEY NEVER REACHES THE BROWSER. This is the whole reason the ETA is a
// server route rather than a map layer: a basemap key has to ship to every
// visitor, a routing key does not. HERE_API_KEY sits in the Function App's
// settings beside the GeoTab and SQL credentials (set-here-secrets.ps1), and
// the browser asks /api/loads/{id}/eta, which asks this.
//
// TRANSACTIONS COST MONEY above the free tier, so every call here is one a
// person asked for and the answer is remembered; see the memo in
// functions/eta.js. Nothing polls HERE.
// ---------------------------------------------------------------------------

const BASE = 'https://router.hereapi.com/v8/routes'
const CALL_TIMEOUT_MS = 20000

// A legal US tractor-trailer at the limits, in the units HERE wants:
// 80,000 lb gross, 13'6" high, 8'6" wide, 72 feet, five axles. These are
// the numbers that decide which roads come back, so they are the profile of
// the heaviest truck in the fleet rather than of any particular one -- an
// ETA that assumes a smaller truck than actually shows up is the failure
// worth avoiding. No load in this app carries its own dimensions yet; when
// one does, they belong here.
const TRUCK = {
  grossWeight: 36287,
  height: 412,
  width: 259,
  length: 2200,
  axleCount: 5,
}

function apiKey() {
  return process.env.HERE_API_KEY || ''
}

// Whether there is a key to try at all. The route turns "no" into a 503 that
// says so, the same way the GeoTab routes do.
function configured() {
  return Boolean(apiKey())
}

class HereError extends Error {
  constructor(status, detail) {
    super(`HERE routing failed: ${detail}`)
    this.name = 'HereError'
    this.status = status
    this.detail = detail
  }
}

// points: [{ latitude, longitude }], in travel order, at least two.
//
// The first is where the truck is now and the rest are the stops it still
// has to make, which is why this takes a list rather than an origin and a
// destination: HERE returns ONE SECTION PER LEG, so a single request -- a
// single transaction -- yields an arrival time for every remaining stop
// rather than just the last one.
function routeUrl(points, mode, { geometry = false, schedule = null } = {}) {
  const p = new URLSearchParams()
  p.set('transportMode', mode)
  p.set('origin', `${points[0].latitude},${points[0].longitude}`)
  p.set('destination', `${points[points.length - 1].latitude},${points[points.length - 1].longitude}`)
  // `polyline` adds the road itself, as a flexible-polyline string per
  // section -- a few thousand points for a day's drive. Asked for only when
  // something is going to draw it: an ETA needs the times and not the shape,
  // and the shape is the larger half of the answer by far.
  // travelSummary as well as summary, always. summary INCLUDES any rest the
  // router inserts -- a section with 36 minutes of driving and a 10-hour
  // reset reports 10h36 -- and travelSummary is the driving alone. Without
  // both, a page cannot say how long a driver is actually at the wheel.
  p.set('return', geometry ? 'summary,travelSummary,polyline' : 'summary,travelSummary')
  // Every waypoint in between, in order. `append`, not `set`: the parameter
  // legitimately appears more than once and the order is the itinerary.
  for (const via of points.slice(1, -1)) p.append('via', `${via.latitude},${via.longitude}`)
  if (mode === 'truck') {
    for (const [k, v] of Object.entries(TRUCK)) p.set(`truck[${k}]`, String(v))
    // The driver's remaining hours, as drive,rest pairs in seconds. The
    // router then plans the rests itself and the arrival times come back
    // with sleep in them. Truck, bus and privateBus only -- which is why it
    // is inside this branch and silently absent from a car fallback.
    if (schedule) p.set('driver[schedule]', schedule)
  }
  // No departureTime: absent means "now at the origin", which is what an ETA
  // for a truck that is already rolling means. Passing `any` would ask for a
  // timeless route with no traffic in it, which is a different question.
  p.set('apikey', apiKey())
  return `${BASE}?${p.toString()}`
}

async function ask(points, mode, options) {
  let res
  try {
    res = await fetch(routeUrl(points, mode, options), { signal: AbortSignal.timeout(CALL_TIMEOUT_MS) })
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') throw err
    throw new HereError(0, err.message)
  }
  const text = await res.text()
  let body = null
  try { body = JSON.parse(text) } catch { /* HERE answers JSON; a body that is not is a failure anyway */ }

  if (!res.ok) {
    // HERE's errors carry `title` and `cause`, and they are fit to show an
    // admin: "Invalid credentials" names exactly what to fix and reveals
    // nothing. The key is in the query string, so it must never appear in a
    // log line -- which is why the URL is not part of this message.
    const detail = (body && (body.cause || body.title || body.error_description)) || `HTTP ${res.status}`
    throw new HereError(res.status, detail)
  }
  return body
}

// Ask for a truck route; fall back to a car one if this account is not
// entitled to truck routing, and SAY WHICH came back so the page can label
// it. A car ETA presented as a truck ETA is the quiet kind of wrong.
//
// 403 is the entitlement answer. 401 is a bad key, which retrying as a car
// will not fix, so it is not retried.
async function routeThrough(points, options = {}) {
  try {
    return { mode: 'truck', body: await ask(points, 'truck', options) }
  } catch (err) {
    if (err instanceof HereError && err.status === 403) {
      return { mode: 'car', body: await ask(points, 'car', options), fellBack: true }
    }
    throw err
  }
}

module.exports = { configured, routeThrough, HereError, TRUCK }
