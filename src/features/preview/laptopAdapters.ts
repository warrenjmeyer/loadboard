import { loadboardAdapter } from '../get-me-home/adapters/loadboardAdapter.ts'
import type { Adapter, Roster } from '../get-me-home/contract.ts'
import type { ApiHours, ApiPositions, ApiZones } from '../get-me-home/adapters/loadboardRoster.ts'
import type { ScheduleAdapter, ScheduleData } from '../home-time-schedule/contract.ts'
import { scopeOpenLoads, scopePlanBoard } from '../driver-load-plans/scope.ts'
import type { LoadPlanAdapter, LoadPlanData, PlanLoad } from '../driver-load-plans/contract.ts'
import { rosterOnLaptop, toLoad, toLoadPlanData, toScheduleData, toStay } from './laptop.ts'
import type { GeoTab, HomeStayRow, LoadRow, PlanDriverRow, ScheduleDriverRow, StayRow } from './laptop.ts'

// ---------------------------------------------------------------------------
// The tabs on the LAPTOP DATABASE: adapters over the dev server's
// /local-db/ requests (tools/local-db/plugin.mjs), which run the host's own
// SQL against the laptop's mvp-techgacity. Dev-only.
//
// This is the host's split, played out on one machine:
//   the database   drivers, loads, plans, stays       /local-db/...
//   GeoTab         positions, hours, town locations   /api/telematics/...
// GeoTab comes through the deployed API, so it needs a dispatcher or admin
// signed in on the dev server. Without that, the loads and stays still come
// through; the legs just cannot be timed or placed, and say so.
//
// Every read is the host's scoped read. The load plans' windows arrive a day
// wider each side (a dock time has no zone until it is given one) and are
// trimmed here to the exact window with the tab's own scope functions.
// ---------------------------------------------------------------------------

type As = 'dispatch' | `driver:${string}`

async function local<T>(path: string, { method = 'GET', body, as = 'dispatch', signal }: {
  method?: 'GET' | 'POST'
  body?: unknown
  as?: As
  signal?: AbortSignal
} = {}): Promise<T> {
  const res = await fetch(`/local-db/${path}`, {
    method,
    signal,
    headers: { Accept: 'application/json', 'X-Local-As': as, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const isJson = (res.headers.get('content-type') || '').includes('application/json')
  if (!isJson) throw new Error('the dev server answered with a page instead of data. Restart `npm run dev` so it loads tools/local-db/plugin.mjs.')
  const json = (await res.json()) as T & { error?: string }
  // The server's own sentence -- "L-10412 is Covered with CNOLAN now, not
  // Available." -- is what the screen shows.
  if (!res.ok) throw new Error(json.error || `/local-db/${path} answered ${res.status}.`)
  return json
}

const q = (params: Record<string, string>) => new URLSearchParams(params).toString()

// ---- GeoTab, through the deployed API -------------------------------------

// Towns do not move: fetched once. Trucks and clocks do: kept two minutes, so
// a tab that makes three reads at once asks GeoTab once.
const FRESH_MS = 2 * 60 * 1000
let zones: Promise<ApiZones | null> | null = null
let live: { at: number; value: Promise<{ positions: ApiPositions | null; hours: ApiHours | null }> } | null = null

async function getOrNull<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { headers: { Accept: 'application/json' } })
    if (!res.ok || !(res.headers.get('content-type') || '').includes('application/json')) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

async function geotab(): Promise<GeoTab> {
  zones ??= getOrNull<ApiZones>('/api/telematics/zones').then((z) => {
    if (!z) zones = null // not signed in, say: ask again next time
    return z
  })
  if (!live || Date.now() - live.at > FRESH_MS) {
    live = {
      at: Date.now(),
      value: Promise.all([getOrNull<ApiPositions>('/api/telematics/positions'), getOrNull<ApiHours>('/api/telematics/hours')])
        .then(([positions, hours]) => ({ positions, hours })),
    }
  }
  const [z, { positions, hours }] = await Promise.all([zones, live.value])
  return { zones: z, positions, hours }
}

// ---- The load plans --------------------------------------------------------

interface LoadPlanRows { loads: LoadRow[]; drivers: PlanDriverRow[]; stays: HomeStayRow[] }

async function planRead(path: string, signal: AbortSignal): Promise<LoadPlanData> {
  const [rows, g] = await Promise.all([local<LoadPlanRows>(path, { signal }), geotab()])
  return toLoadPlanData(rows, g)
}

export const laptopLoadPlanAdapter: LoadPlanAdapter = {
  async loadPlanBoard({ from, to, signal }) {
    return scopePlanBoard(await planRead(`load-plans/board?${q({ from, to })}`, signal), { from, to })
  },
  async loadDriverPlan({ driverCode, signal }) {
    return planRead(`load-plans/driver?${q({ driverCode })}`, signal)
  },
  async loadOpenLoads({ from, to, signal }) {
    return scopeOpenLoads(await planRead(`load-plans/open?${q({ from, to })}`, signal), { from, to })
  },
  async loadCandidates({ loadId, signal }) {
    return planRead(`load-plans/candidates?${q({ loadId })}`, signal)
  },
  async assignLoad(loadId, driverCode): Promise<PlanLoad> {
    const { load } = await local<{ load: LoadRow }>('load-plans/assign', { method: 'POST', body: { loadId, driverCode } })
    return toLoad(load, (await geotab()).zones)
  },
  async unassignLoad(loadId): Promise<PlanLoad> {
    const { load } = await local<{ load: LoadRow }>('load-plans/unassign', { method: 'POST', body: { loadId } })
    return toLoad(load, (await geotab()).zones)
  },
}

// ---- The schedule ----------------------------------------------------------

interface StayRows { stays: StayRow[]; drivers: ScheduleDriverRow[] }

function scheduleAdapterAs(as: As): ScheduleAdapter {
  return {
    async loadQueue({ signal }) {
      return toScheduleData(await local<StayRows>('stays/queue', { as, signal }))
    },
    async loadBoard({ from, to, signal }) {
      return toScheduleData(await local<StayRows>(`stays/board?${q({ from, to })}`, { as, signal }))
    },
    async loadDriverStays({ driverCode, signal }) {
      return toScheduleData(await local<StayRows>(`stays/driver?${q({ driverCode })}`, { as, signal }))
    },
    async loadStay({ id, signal }): Promise<ScheduleData> {
      // The laptop's stays are numbered; anything else is no stay of its.
      if (!/^\d+$/.test(id)) return { drivers: [], stays: [] }
      return toScheduleData(await local<StayRows>(`stays/stay?${q({ id })}`, { as, signal }))
    },
    async requestStay(stay) {
      const { stay: row } = await local<{ stay: StayRow }>('stays/request', { method: 'POST', as, body: stay })
      return toStay(row)
    },
    async actOnStay(id, action) {
      const { stay: row } = await local<{ stay: StayRow }>('stays/act', { method: 'POST', as, body: { id, action } })
      return toStay(row)
    },
  }
}

/** Dispatch's schedule on the laptop database. */
export const laptopScheduleAdapter: ScheduleAdapter = scheduleAdapterAs('dispatch')

// One adapter per driver, made once each: a module's adapter must be stable.
const asDriver = new Map<string, ScheduleAdapter>()
/** The schedule as that driver sees it: every read and move is made AS them,
 * so the host's WHO checks decide what comes back. */
export function laptopScheduleAdapterFor(driverCode: string): ScheduleAdapter {
  let adapter = asDriver.get(driverCode)
  if (!adapter) asDriver.set(driverCode, (adapter = scheduleAdapterAs(`driver:${driverCode}`)))
  return adapter
}

/** The laptop's drivers, for the preview's driver picker. */
export async function laptopDrivers(): Promise<{ driverCode: string; name: string }[]> {
  return (await local<{ drivers: { driverCode: string; name: string }[] }>('drivers')).drivers
}

// ---- The planner -----------------------------------------------------------

// The planner's live drivers -- Millstream and GeoTab, through the deployed
// API -- with their current loads and home time from the laptop database
// (rosterOnLaptop in laptop.ts): the same joins wiring.ts makes for the
// samples, made with the laptop's rows. A year each side, so a load under
// way since long ago and a stay long past both come back.
async function onLaptop(roster: Roster, signal: AbortSignal): Promise<Roster> {
  const year = 365 * 24 * 3600 * 1000
  const window = { organizationId: null, from: new Date(Date.now() - year).toISOString(), to: new Date(Date.now() + year).toISOString(), signal }
  const [plans, schedule] = await Promise.all([laptopLoadPlanAdapter.loadPlanBoard(window), laptopScheduleAdapter.loadBoard(window)])
  return rosterOnLaptop(roster, { plans, schedule, now: new Date().toISOString() })
}

export const plannerOnLaptop: Adapter = {
  async loadRoster(args) {
    return onLaptop(await loadboardAdapter.loadRoster(args), args.signal)
  },
  async loadDriver(args) {
    return onLaptop(await loadboardAdapter.loadDriver(args), args.signal)
  },
}

/** Who is signed in on the dev server, if anyone -- GeoTab needs dispatch. */
export async function signedIn(): Promise<{ name: string; role: string } | null> {
  const me = await getOrNull<{ user: { email: string; displayName: string | null; role: string } | null }>('/api/me')
  return me?.user ? { name: me.user.displayName || me.user.email, role: me.user.role } : null
}
