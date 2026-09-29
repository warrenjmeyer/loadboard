import type { Adapter } from '../contract.ts'
import { buildLoadboardRoster } from './loadboardRoster.ts'
import type { ApiHours, ApiPositions, ApiRosterDriver, ApiZones } from './loadboardRoster.ts'

// ---------------------------------------------------------------------------
// The planner on the load board's real data: the load board's own API, read
// through the dev server's proxy -- the same four answers the fleet page and
// the load map already use. See loadboardRoster.ts for what becomes what.
//
// It has to be signed in. GeoTab hours are a dispatcher's to see, the API
// checks, and on the dev server that means signing in at /signin first. Every
// refusal is turned into the sentence that says what to do about it, because
// "HTTP 401" on a planner nobody told to sign in reads like a bug.
//
// Plain fetch, not the load board's src/lib/api.js: this folder imports
// nothing from outside itself, adapters included, so it type-checks alone.
// ---------------------------------------------------------------------------
async function get<T>(path: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal, headers: { Accept: 'application/json' } })
  const isJson = (res.headers.get('content-type') || '').includes('application/json')

  if (res.ok) {
    // The dev server answers an /api it cannot reach with index.html and a
    // 200 -- a page where data was expected. Say that, not "Unexpected token <".
    if (!isJson) throw new Error('the dev server answered with a page instead of data. Restart `npm run dev` and try again.')
    return (await res.json()) as T
  }

  let body: { error?: string; configured?: boolean } | null = null
  if (isJson) {
    try { body = await res.json() } catch { /* an unreadable body adds nothing to the status */ }
  }
  if (res.status === 401) {
    throw new Error('you are not signed in on this dev server. Open /signin here, sign in as a dispatcher or admin, then come back and press Refresh.')
  }
  if (res.status === 403) {
    throw new Error(`${body?.error || 'this account cannot see that.'} Live data needs a dispatcher or admin account.`)
  }
  if (res.status === 503 && body?.configured === false) {
    throw new Error('GeoTab is not connected on the API, so there are no positions or hours to read.')
  }
  if (res.status >= 500) {
    throw new Error(`${body?.error || `${path} answered ${res.status}.`} The database pauses when idle and can take a minute to wake -- press Refresh in a moment.`)
  }
  throw new Error(body?.error || `${path} answered ${res.status}.`)
}

export const loadboardAdapter: Adapter = {
  async loadRoster({ signal }) {
    // Four at once: none depends on another, and the slowest -- hours, a
    // GeoTab round trip per driver -- sets the pace either way.
    const [roster, positions, hours, zones] = await Promise.all([
      get<ApiRosterDriver[]>('/api/roster', signal),
      get<ApiPositions>('/api/telematics/positions', signal),
      get<ApiHours>('/api/telematics/hours', signal),
      get<ApiZones>('/api/telematics/zones', signal),
    ])
    return buildLoadboardRoster({ roster, positions, hours, zones })
  },
}
