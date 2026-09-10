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

// The JSON body of a failed response, or null when it has none -- a platform
// page, say: Static Web Apps answers an unauthorised POST with HTML, not JSON.
async function jsonBody(res) {
  try {
    const type = res.headers.get('content-type') || ''
    if (type.includes('application/json')) return await res.json()
  } catch {
    // Ignore: an unreadable error body is not more interesting than the
    // status code we already have.
  }
  return null
}

// A failed response may carry {"error": "..."} from our own function. Try
// for the useful message, fall back to the given one.
async function messageFrom(res, fallback) {
  const body = await jsonBody(res)
  return body && body.error ? body.error : fallback
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

      // A 503 that carries our own {"configured": false} is an answer, not an
      // outage: the server is up and saying a feature has not been set up.
      // Retrying cannot set it up, and three waits followed by a red "could
      // not read" turns what should be one quiet line into an alarm. It is
      // fatal with its status so the caller can tell it from a real failure.
      if (res.status === 503) {
        const body = await jsonBody(res)
        if (body && body.configured === false) throw fatal(body.error || 'Not configured.', 503)
        throw new Error((body && body.error) || `HTTP ${res.status}`)
      }

      // Any other 5xx falls through to the retry. The server message is
      // carried on the error anyway, so if the retries run out the caller
      // still gets the useful sentence rather than "HTTP 502".
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

// A file upload. No Content-Type header: the browser sets multipart with
// its own boundary, and naming it by hand breaks exactly that. Retried
// like a POST -- a second copy of a POD is a nuisance, not a wrong
// payment -- but only after the database-waking failure, never a 4xx.
export function postForm(path, formData, options) {
  return request(path, { method: 'POST', body: formData }, options)
}

// PUT replaces a whole resource -- a load's itinerary -- and is idempotent
// by definition: sending the same list twice leaves the same list.
export function putJson(path, body, options) {
  return request(
    path,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    options
  )
}

// DELETE is the one method that is honestly not idempotent in effect: a
// retry of a delete that landed meets a 404, which is an answer, not a
// failure, and the caller treats it as done. Retrying is still right for the
// same reason as PATCH -- a first attempt lost to the database waking up
// leaves the row where it was.
export function deleteJson(path, options) {
  return request(path, { method: 'DELETE' }, options).catch((err) => {
    if (err.status === 404) return null
    throw err
  })
}
