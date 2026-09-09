import { useState, useEffect } from 'react'
import { fetchJson } from './api.js'

// ---------------------------------------------------------------------------
// Ask /api/telematics for something, and keep asking while the page is open.
//
// Positions go stale in a minute, which is why this polls; nothing else in
// the app does, because nothing else changes unless somebody in the app
// changes it. The interval is generous -- Geotab itself only hears from a
// truck every so often, and the server remembers an answer for twenty
// seconds anyway, so polling faster would show the same numbers sooner.
//
// Three outcomes, kept apart because the page says different things:
//
//   data           the answer
//   notConnected   503 from the server: no GeoTab credential configured.
//                  Not an error. The page hides the section, or says "not
//                  connected" once, quietly.
//   error          anything else -- Geotab refused, timed out, the database
//                  fell over. Shown, because somebody should look at it.
//
// `enabled` false means do not ask at all: the reader has no role, or the
// load has no truck, and there is nothing to poll for.
// ---------------------------------------------------------------------------
export const POLL_MS = 60000

export function useTelematics(path, { enabled = true, every = POLL_MS } = {}) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [notConnected, setNotConnected] = useState(false)
  const [loading, setLoading] = useState(Boolean(enabled && path))

  useEffect(() => {
    if (!enabled || !path) {
      setLoading(false)
      return undefined
    }
    let cancelled = false
    let timer = null

    async function ask() {
      try {
        const answer = await fetchJson(path)
        if (cancelled) return
        setData(answer)
        setError(null)
        setNotConnected(false)
      } catch (err) {
        if (cancelled) return
        if (err.status === 503) {
          setNotConnected(true)
          setError(null)
          return // and do not schedule another ask: the answer will not change
        }
        // A 401 or 403 is an answer about the reader, not about Geotab, and
        // the page already gates on the role. Say nothing rather than
        // shouting about a section the reader was never going to see.
        if (err.status === 401 || err.status === 403) {
          setNotConnected(true)
          return
        }
        setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
      if (!cancelled && every > 0) timer = setTimeout(ask, every)
    }

    setLoading(true)
    ask()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [path, enabled, every])

  return { data, error, notConnected, loading }
}
