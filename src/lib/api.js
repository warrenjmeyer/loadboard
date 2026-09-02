// ---------------------------------------------------------------------------
// Every call to /api goes through here.
//
// Why it retries: the database is serverless and pauses itself when nobody
// uses it. Waking it takes 30-60 seconds, and Azure Static Web Apps cuts a
// function request off well before that (around 45s), so the FIRST request
// after a quiet spell fails. No timeout set inside the function can change
// that -- the platform gives up first.
//
// The saving grace is that the request which failed is what started the
// wake-up. By the time we ask again the database is usually up, so a couple of
// retries turn an error into a slow load.
//
// `onWaking` is called before the first retry so the caller can say something
// honest to the person waiting.
// ---------------------------------------------------------------------------

const RETRY_WAITS_MS = [3000, 6000, 10000]

function fatal(message, status, extra) {
  const err = new Error(message)
  err.fatal = true
  if (status) err.status = status
  return Object.assign(err, extra)
}

// A failed response may carry {"error": "..."} from our own function, or it
// may be a platform page -- Static Web Apps answers an unauthorised POST with
// HTML, not JSON. Try for the useful message, fall back to the given one.
async function messageFrom(res, fallback) {
  try {
    const type = res.headers.get('content-type') || ''
    if (type.includes('application/json')) {
      const body = await res.json()
      if (body && body.error) return body.error
    }
  } catch {
    // Ignore: an unreadable error body is not more interesting than the
    // status code we already have.
  }
  return fallback
}

async function request(path, init, { onWaking } = {}) {
  for (let attempt = 0; attempt <= RETRY_WAITS_MS.length; attempt++) {
    try {
      const res = await fetch(path, init)

      // These four are answers, not failures. Retrying will not make the row
      // exist, the input valid, or the user signed in, so fail immediately
      // rather than making someone wait through three delays to be told the
      // same thing.
      if (res.status === 404) throw fatal('Not found.', 404)
      if (res.status === 400) throw fatal(await messageFrom(res, 'That load is not valid.'), 400)
      if (res.status === 401 || res.status === 403) {
        throw fatal(await messageFrom(res, 'Sign in to add a load.'), res.status)
      }
      if (res.status === 409) {
        // `attempt > 0` matters. A POST is retried above because the insert is
        // guarded by the primary key and so is safe to repeat -- but that
        // means a first attempt which timed out while the database woke may
        // have landed anyway, and the retry then meets its own row. The
        // caller is told, because "you picked a duplicate" and "your load
        // saved after all" need different responses.
        throw fatal(await messageFrom(res, 'That load number already exists.'), 409, {
          mayHaveLanded: attempt > 0,
        })
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      // 204 has no body to parse. Nothing returns one today; this is here so
      // that the day something does, it fails as a missing feature rather
      // than as an unexplained JSON parse error.
      if (res.status === 204) return null

      // A 200 is not proof you got what you asked for. With no /api available,
      // the dev server answers with index.html -- the SPA fallback -- and that
      // is a perfectly good 200. Parsing it fails with "Unexpected token '<'",
      // which describes the symptom and hides the cause.
      const type = res.headers.get('content-type') || ''
      if (!type.includes('application/json')) {
        throw fatal('the API did not respond. Restart the dev server, then reload.')
      }

      return await res.json()
    } catch (err) {
      if (err.fatal || attempt === RETRY_WAITS_MS.length) throw err
      onWaking?.()
      await new Promise((resolve) => setTimeout(resolve, RETRY_WAITS_MS[attempt]))
    }
  }
}

export function fetchJson(path, options) {
  return request(path, undefined, options)
}

// Retrying a POST is normally the thing you must not do -- repeat it and you
// get two of whatever it created. It is safe here for one specific reason:
// the load number is chosen by the caller and is the primary key, so a second
// insert of the same body cannot produce a second row. It produces a 409,
// which is handled above.
export function postJson(path, body, options) {
  return request(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    options
  )
}

// ---------------------------------------------------------------------------
// Who is signed in, according to Static Web Apps.
//
// /.auth/me is served by the platform, not by our function, and it is the
// only honest source: the browser cannot be trusted to remember, and the
// cookie it depends on is deliberately unreadable from JavaScript.
//
// Returns null when nobody is signed in -- and also in dev, where the auth
// cookie belongs to the deployed origin and never reaches localhost. That is
// the same "dev talks to production" seam the API proxy has, and it is why
// writes are blocked in dev; see vite.config.js.
// ---------------------------------------------------------------------------
export async function fetchUser() {
  try {
    const res = await fetch('/.auth/me')
    if (!res.ok) return null

    const type = res.headers.get('content-type') || ''
    if (!type.includes('application/json')) return null

    const body = await res.json()
    return body?.clientPrincipal ?? null
  } catch {
    // Being unable to ask is the same as not being signed in, as far as the
    // page is concerned. The POST is gated on the server either way.
    return null
  }
}
