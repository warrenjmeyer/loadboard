const { app } = require('@azure/functions')
const identity = require('../identity')
const here = require('../here')

// ---------------------------------------------------------------------------
// The basemap, fetched on the app's behalf rather than the browser's.
//
//   GET /api/maptile/{z}/{x}/{y}
//
// WHY A PROXY AND NOT A URL IN THE PAGE. Every other mapping site puts its
// key in the bundle and restricts it to a domain. That works, and it means
// the credential is readable by anyone who opens the network tab. This app
// has never shipped a credential to a client -- the SQL password, the GeoTab
// login and the HERE routing key all live in the Function App's settings --
// and a basemap is not a good enough reason to start. So the tile request
// comes here, this adds the key, and HERE answers this.
//
// It costs a hop of latency per tile. In exchange the key cannot leak from
// the page, it can be rotated without a deploy, and -- the part that matters
// on a metered API -- there is exactly one place to see the traffic and cap
// it if it runs away.
//
// EACH TILE IS A BILLED TRANSACTION. Not each map: each tile. Measured on
// this app's lanes a view is four to six of them, so a basemap costs a few
// ETAs every time a load is opened with streets on. Which is why the app
// draws none until somebody presses Streets, why the zoom range is bounded
// here as well as in the browser, and why the answer is cached hard: a road
// moves about as often as a geofence does.
// ---------------------------------------------------------------------------

// lite.day: the quiet style. explore.day is the ordinary street map and
// slightly busier; the logistics.* styles draw truck restrictions and bill
// as ADVANCED rather than base, so they are deliberately not the default on
// something fetched several times a view.
const STYLE = process.env.HERE_TILE_STYLE || 'lite.day'
const SIZE = 512
const FORMAT = 'png8'
const TILE_TIMEOUT_MS = 15000

// The same bounds src/lib/tiles.js uses. Repeated rather than imported --
// the api and the browser bundle are separate programs -- because a limit
// that only exists in the page is not a limit at all: this route is public
// to anyone signed in, and z20 over a city is thousands of transactions.
const MIN_ZOOM = 2
const MAX_ZOOM = 12

// A backstop, not an accountant. It counts what THIS Function instance has
// served since it last started, so a scale-out or a restart resets it and
// two instances could each serve this many. It exists to turn a runaway
// loop into a 429 rather than a bill, and the real limit is HERE's own
// dashboard.
const DAILY_CAP = 5000
let served = 0
let countingSince = Date.now()

function tileUrl(z, x, y) {
  const key = process.env.HERE_API_KEY || ''
  return `https://maps.hereapi.com/v3/base/mc/${z}/${x}/${y}/${FORMAT}`
    + `?style=${encodeURIComponent(STYLE)}&size=${SIZE}&ppi=100&apiKey=${encodeURIComponent(key)}`
}

async function maptile(request, context) {
  const user = await identity.currentUser(request)
  if (!user) return identity.unauthorized('Sign in to see the map.')
  if (user.role === 'none') return identity.forbidden('Your account is waiting for approval.')

  if (!here.configured()) {
    return {
      status: 503,
      jsonBody: { error: 'HERE is not connected on this server. Set HERE_API_KEY in the app settings.', configured: false },
      headers: { 'Cache-Control': 'no-store' },
    }
  }

  const z = Number(request.params.z)
  const x = Number(request.params.x)
  const y = Number(request.params.y)
  const whole = (n) => Number.isInteger(n)
  if (!whole(z) || !whole(x) || !whole(y) || z < MIN_ZOOM || z > MAX_ZOOM) {
    return { status: 400, jsonBody: { error: 'Not a tile this map asks for.' } }
  }
  const span = 2 ** z
  if (x < 0 || x >= span || y < 0 || y >= span) {
    return { status: 400, jsonBody: { error: 'That tile is off the edge of the world.' } }
  }

  if (Date.now() - countingSince > 24 * 3600 * 1000) {
    served = 0
    countingSince = Date.now()
  }
  if (served >= DAILY_CAP) {
    context.warn(`maptile: instance cap of ${DAILY_CAP} reached; refusing until the count rolls over`)
    return {
      status: 429,
      jsonBody: { error: 'The map has drawn its allowance of tiles for today.' },
      headers: { 'Cache-Control': 'no-store' },
    }
  }

  let res
  try {
    res = await fetch(tileUrl(z, x, y), { signal: AbortSignal.timeout(TILE_TIMEOUT_MS) })
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return { status: 504, jsonBody: { error: 'The map service did not answer in time.' } }
    }
    context.error('maptile fetch failed:', err.message)
    return { status: 502, jsonBody: { error: 'Could not fetch a map tile.' } }
  }

  if (!res.ok) {
    // Never log the URL: the key is in it. The status alone says enough --
    // 401 is a bad key, 403 is a plan without tiles on it.
    const body = await res.text()
    context.error(`maptile: HERE answered ${res.status} ${body.slice(0, 200)}`)
    return {
      status: 502,
      jsonBody: { error: `The map service refused that tile (${res.status}).`, configured: true },
      headers: { 'Cache-Control': 'no-store' },
    }
  }

  served += 1
  const bytes = Buffer.from(await res.arrayBuffer())
  return {
    status: 200,
    body: bytes,
    headers: {
      'Content-Type': res.headers.get('content-type') || 'image/png',
      // A day in the browser, and private because it was fetched with this
      // app's credential on this reader's behalf. Every cache hit is a
      // transaction not spent, which is the cheapest saving available here.
      'Cache-Control': 'private, max-age=86400',
    },
  }
}

app.http('maptile', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'maptile/{z}/{x}/{y}',
  handler: maptile,
})
