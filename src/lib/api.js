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

// Fallbacks for when the response carries no {"error": ...} of its own --
// a platform page rather than one of ours.
const DEFAULT_MESSAGE = {
  400: 'That request was not valid.',
  401: 'Sign in to continue.',
  403: 'Your account does not have access to that.',
  404: 'Not found.',
  409: 'That already exists.',
  429: 'Too many attempts. Wait a few minutes and try again.',
}

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

      // Any 4xx is an answer, not a failure. Retrying will not make the row
      // exist, the input valid, the user signed in, or the throttle lift --
      // and retrying a 429 in particular is the one thing guaranteed to make
      // it worse, since each attempt extends the window it is counting.
      if (res.status >= 400 && res.status < 500) {
        const extra = res.status === 409 ? { mayHaveLanded: attempt > 0 } : undefined
        // `mayHaveLanded` matters because a POST is retried below: the insert
        // is guarded by a primary key and so is safe to repeat, but a first
        // attempt that timed out while the database woke may have landed
        // anyway, and the retry then meets its own row.
        throw fatal(await messageFrom(res, DEFAULT_MESSAGE[res.status] || 'That request was refused.'), res.status, extra)
      }

      // 5xx falls through to the retry. The server message is carried on the
      // error anyway, so if the retries run out the caller still gets the
      // useful sentence rather than "HTTP 503".
      if (!res.ok) throw new Error(await messageFrom(res, `HTTP ${res.status}`))

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

// A PATCH is retried for the same reason a POST is, and it is safe for a
// different one: every change /api/loads/{id} accepts is idempotent. Assigning
// Smith twice leaves Smith assigned; marking In Transit twice is a no-op the
// server answers with the row as it is. A first attempt that timed out while
// the database woke and landed anyway is therefore indistinguishable from a
// first attempt that never arrived -- which is exactly the property a retry
// needs.
export function patchJson(path, body, options) {
  return request(
    path,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    options
  )
}
