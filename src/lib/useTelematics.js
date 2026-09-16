import { useState, useEffect, useMemo } from 'react'
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
// IT STOPS WHEN THE TAB IS HIDDEN. See the long note in the effect: the
// database this app runs on is billed for being awake rather than for being
// queried, and a forgotten tab polling all night is what exhausted a month
// of it.
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

// An ETA is a metered call to a third party, so it is asked for far less
// often than a position -- and never faster than the server keeps its own
// answer, which is also five minutes. A number about the next four hours
// does not change usefully in less.
export const ETA_POLL_MS = 300000

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

    // A HIDDEN TAB ASKS NOTHING. This is not a nicety, it is the bill.
    //
    // The database is Azure SQL serverless on the free monthly allowance --
    // about a hundred thousand vCore-seconds, which at its minimum size is
    // roughly fifty-five hours of being AWAKE, not of being used. It only
    // falls asleep after an hour with no query. So one forgotten tab polling
    // this every sixty seconds keeps it awake around the clock and spends
    // the whole month in about two and a half days, whether anybody is
    // looking at the screen or not. That is exactly what happened in
    // September 2026: the database paused itself mid-month and every page in
    // the app started answering 500.
    //
    // So: no timer while the tab is hidden, and one immediate ask when it
    // comes back, because the first thing someone wants on returning is
    // current numbers rather than a minute-old screen.
    const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

    function schedule() {
      if (cancelled || every <= 0 || isHidden()) return
      timer = setTimeout(ask, every)
    }

    async function ask() {
      if (timer) { clearTimeout(timer); timer = null }
      if (cancelled) return
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
      schedule()
    }

    function onVisibilityChange() {
      if (isHidden()) {
        if (timer) { clearTimeout(timer); timer = null }
      } else {
        ask()
      }
    }

    setLoading(true)
    ask()
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange)
    }
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }
    }
  }, [path, enabled, every])

  return { data, error, notConnected, loading }
}

// ---------------------------------------------------------------------------
// The fleet's named places, for the load map. One fetch, not a poll: a
// geofence is drawn once and then sits there for years, and the server keeps
// its own copy for a day.
//
// Handed back as a Map keyed the way telematicsRules.zoneKey keys it --
// trimmed, single-spaced, upper-cased -- so a stop's `place` can be looked
// up directly. Keying here rather than in the component means the map is
// built once per fetch instead of once per render.
// ---------------------------------------------------------------------------
export function zoneKey(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toUpperCase()
}

export function useZones({ enabled = true } = {}) {
  const { data, error, notConnected, loading } = useTelematics(
    enabled ? '/api/telematics/zones' : null,
    { enabled, every: 0 }
  )
  const zonesByKey = useMemo(() => {
    if (!data || !data.zones) return null
    return new Map(data.zones.map((z) => [z.key || zoneKey(z.name), z]))
  }, [data])
  return { zonesByKey, error, notConnected, loading }
}
