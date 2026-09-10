// ---------------------------------------------------------------------------
// The MyGeotab API, from the server.
//
// Until now the two systems were tied together by a NAME -- src/lib/geotab.js
// builds a link to a route called "ORIGIN - DESTINATION" and nothing more.
// This module is the first RUNTIME link: it signs in to MyGeotab with a
// service credential held in the Function App's settings and reads back what
// the trucks are doing. Nothing here writes to Geotab, and nothing in the
// browser ever sees the credential: the browser talks to /api/telematics,
// which talks to this.
//
// The API is JSON-RPC over POST to https://<server>/apiv1. Three things about
// it are worth knowing before touching this file, all learned the hard way in
// geotab-common.ps1 and repeated here so nobody learns them a third time:
//
//   1. Geotab answers HTTP 200 whether the call worked or not. The failure is
//      an `error` object in the body, so a caller checking only the status
//      code treats every rejection as success.
//
//   2. Authenticate hands back a `path`. 'ThisServer' means stay put; anything
//      else is the server every later call must go to. Ignoring it is the
//      classic reason a client authenticates and then fails on everything.
//
//   3. Sessions expire. The API says so with an InvalidUserException, and the
//      right response is to sign in again once and retry -- not to fail, and
//      not to loop.
//
// The session is cached in module scope, which lives as long as the Function
// host does. Warm instances reuse it; a cold start signs in once. There is no
// locking around it because two overlapping sign-ins produce two valid
// sessions, which is wasteful and harmless.
// ---------------------------------------------------------------------------

const DEFAULT_SERVER = 'my.geotab.com'
const CALL_TIMEOUT_MS = 20000

function settings() {
  return {
    server: process.env.GEOTAB_SERVER || DEFAULT_SERVER,
    database: process.env.GEOTAB_DATABASE || '',
    userName: process.env.GEOTAB_USER || '',
    password: process.env.GEOTAB_PASSWORD || '',
  }
}

// Whether there is a credential to try at all. The routes turn "no" into a
// 503 that says so, which is a better answer than a stack trace from fetch.
function configured() {
  const s = settings()
  return Boolean(s.database && s.userName && s.password)
}

class GeotabError extends Error {
  constructor(method, detail, name) {
    super(`Geotab ${method} failed: ${detail}`)
    this.name = 'GeotabError'
    this.method = method
    this.geotabName = name || null
  }
}

// One raw call. `server` is where to send it; credentials, if any, ride in
// params like every other argument -- that is how the API is shaped.
async function rpc(server, method, params) {
  const res = await fetch(`https://${server}/apiv1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  })
  if (!res.ok) throw new GeotabError(method, `HTTP ${res.status}`)
  const body = await res.json()
  if (body && body.error) {
    const first = body.error.errors && body.error.errors[0]
    throw new GeotabError(method, (first && first.message) || body.error.message || 'unknown error', first && first.name)
  }
  return body.result
}

// { credentials, server } once signed in. Cached; see the header.
let session = null

async function authenticate() {
  const s = settings()
  if (!configured()) throw new GeotabError('Authenticate', 'GEOTAB_DATABASE, GEOTAB_USER and GEOTAB_PASSWORD are not all set')
  const result = await rpc(s.server, 'Authenticate', {
    userName: s.userName,
    password: s.password,
    database: s.database,
  })
  const server = result.path && result.path !== 'ThisServer' ? result.path : s.server
  session = { credentials: result.credentials, server }
  return session
}

function isExpiredSession(err) {
  return err instanceof GeotabError && err.geotabName === 'InvalidUserException'
}

// A call with the session attached, signing in first if there is none and
// again -- once -- if Geotab says the one we had has expired.
async function call(method, params = {}) {
  let s = session || (await authenticate())
  try {
    return await rpc(s.server, method, { ...params, credentials: s.credentials })
  } catch (err) {
    if (!isExpiredSession(err)) throw err
    session = null
    s = await authenticate()
    return rpc(s.server, method, { ...params, credentials: s.credentials })
  }
}

// Get every entity of a type, optionally narrowed by a search object.
function get(typeName, search, resultsLimit) {
  const params = { typeName }
  if (search) params.search = search
  if (resultsLimit) params.resultsLimit = resultsLimit
  return call('Get', params)
}

// Coordinates to addresses, Geotab's own reverse geocoding. One API call
// however many coordinates are sent, which is what makes it affordable
// under the 250-a-minute quota: every truck on the fleet page is one call.
// Answers come back in the same order as the coordinates, each with
// city, region, country and a formattedAddress.
function getAddresses(coordinates) {
  if (!coordinates.length) return Promise.resolve([])
  return call('GetAddresses', {
    coordinates: coordinates.map((c) => ({ x: c.longitude, y: c.latitude })),
    movingAddresses: false,
  })
}

// Several calls in one round trip. The answer is an array in the same order
// as the calls, which is what lets the caller zip results back to drivers.
// Twenty-four drivers' hours in one request rather than forty-eight.
function multiCall(calls) {
  if (calls.length === 0) return Promise.resolve([])
  return call('ExecuteMultiCall', { calls })
}

// For tests and for the one case where forgetting is right: a credential
// changed in Azure and the cached session belongs to the old one.
function forget() {
  session = null
}

module.exports = { configured, call, get, multiCall, getAddresses, authenticate, forget, GeotabError, settings }
