// ---------------------------------------------------------------------------
// fetchJson -- every call to /api goes through here.
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

function fatal(message, status) {
  const err = new Error(message)
  err.fatal = true
  if (status) err.status = status
  return err
}

export async function fetchJson(path, { onWaking } = {}) {
  for (let attempt = 0; attempt <= RETRY_WAITS_MS.length; attempt++) {
    try {
      const res = await fetch(path)

      // A missing record is an answer, not a failure. Retrying will not make
      // the row exist, so fail immediately rather than making the user wait
      // through three delays to be told the same thing.
      if (res.status === 404) throw fatal('Not found.', 404)

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

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
