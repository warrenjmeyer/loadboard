// ---------------------------------------------------------------------------
// THE CONTRACT for the Driver Load Plans tab: what it needs from the app it
// runs in, and what it asks that app to do.
//
// A driver's PLAN is the loads assigned to them, in pickup order: the one
// they are on (In Transit), then the ones lined up next (Covered). Planning
// is putting an Available load on a driver's plan, or taking it back.
//
// On the host that is a row in DRVR.Load_Plans (src/features/sql/
// 04_DRVR_Load_Plans.sql): PLANNED while it is on the plan, TAKEN_BACK once
// it comes off, the row kept either way. TMS.Loads is never written. A
// load's status here is worked out by the view DRVR.Loads_For_Planning:
// Delivered, Cancelled and In Transit from TMS.Loads' own status; Covered
// when it is on a plan; Available otherwise.
//
// Same units as the other tabs: moments are ISO 8601 WITH A ZONE, durations
// are seconds, places carry decimal-degree coordinates.
//
// No runtime imports, so plain Node can load it, and so it moves on its own.
// ---------------------------------------------------------------------------

/** ISO 8601 date-time WITH a zone. */
export type IsoMoment = string

export const LOAD_STATUSES = ['Available', 'Covered', 'In Transit', 'Delivered', 'Cancelled'] as const
export type LoadStatus = (typeof LOAD_STATUSES)[number]

// The rows of DRVR.fk_Load_Plan_Status, spelled exactly as its
// Load_Plan_Status column spells them -- the name is the code, as with the
// schedule's statuses, and lookups.ts checks the two still agree. One step
// (decided 2026-09-29): on the plan, or taken back off it.
export const PLAN_STATUSES = ['PLANNED', 'TAKEN_BACK'] as const
export type PlanStatus = (typeof PLAN_STATUSES)[number]

export interface Place {
  /** "Joliet, IL" */
  place: string | null
  latitude: number | null
  longitude: number | null
}

export interface PlanLoad {
  /** The load number. */
  id: string
  status: LoadStatus
  /** Who hauls it; null while Available. */
  driverCode: string | null
  origin: Place
  destination: Place
  /** The pickup and delivery windows, as the customer gave them. */
  pickupStart: IsoMoment | null
  pickupEnd: IsoMoment | null
  deliveryStart: IsoMoment | null
  deliveryEnd: IsoMoment | null
  /** Loaded miles -- the load's own, not the empty ones to reach it. */
  miles: number | null
  rate?: number | null
  equipment?: string | null
  /** When it went on the plan it is on (DRVR.Load_Plans.Planned_At). Null
   * while Available, and for loads planned before anything recorded it. */
  plannedAt?: IsoMoment | null
}

/** Seconds LEFT on each hours-of-service clock; null when unknown. The
 * planner's Hours, field for field. */
export interface Hours {
  driving: number | null
  duty: number | null
  cycle: number | null
  rest?: number | null
  workday?: number | null
}

export interface PlanDriver {
  driverCode: string
  name: string
  unitNo: string | null
  home: Place
  /** Where the truck last reported. */
  position: (Place & { reportedAt: IsoMoment | null }) | null
  hours: Hours | null
}

/** Time at home that a load must not run into: approved, or already there.
 * The Driver Home Time Schedule's stays, reduced to what planning needs. */
export interface HomeStay {
  driverCode: string
  homeBy: IsoMoment
  backOut: IsoMoment
  status: 'APPROVED' | 'HOME'
}

export interface LoadPlanData {
  /** Pin the clock (sample data). Leave it out for live data. */
  asOf?: IsoMoment
  drivers: PlanDriver[]
  loads: PlanLoad[]
  stays: HomeStay[]
  about?: string
}

/** Every read gets these. */
export interface ReadArgs {
  organizationId: string | null
  signal: AbortSignal
}

/** What the tab needs from the host. Keep it STABLE (module scope or useMemo).
 *
 * READS ARE SCOPED PER SCREEN, as in the other tabs: each module asks for
 * what it shows and no more. scope.ts says exactly what each returns.
 *
 * WHO: this is a dispatch tab, and every method is dispatch's alone. The
 * server enforces that from the signed-in user; the screens are courteous,
 * the server is strict. */
export interface LoadPlanAdapter {
  /** Every active driver; their Covered and In Transit loads that touch the
   * window; the approved or current stays that touch it. WHO: dispatch. */
  loadPlanBoard(args: ReadArgs & { from: IsoMoment; to: IsoMoment }): Promise<LoadPlanData>
  /** One driver, their Covered and In Transit loads, their stays. WHO: dispatch. */
  loadDriverPlan(args: ReadArgs & { driverCode: string }): Promise<LoadPlanData>
  /** Available loads whose pickup falls in the window; no drivers. WHO: dispatch. */
  loadOpenLoads(args: ReadArgs & { from: IsoMoment; to: IsoMoment }): Promise<LoadPlanData>
  /** One open load, and what it takes to rank drivers for it: every active
   * driver with their position, hours, planned loads and stays. WHO: dispatch. */
  loadCandidates(args: ReadArgs & { loadId: string }): Promise<LoadPlanData>
  /** Put an Available load on a driver's plan. Resolves to the load as stored.
   * WHO: dispatch. */
  assignLoad(loadId: string, driverCode: string): Promise<PlanLoad>
  /** Take a Covered load back off a plan. WHO: dispatch. */
  unassignLoad(loadId: string): Promise<PlanLoad>
}

// ---------------------------------------------------------------------------
// Checking data from outside -- `unknown`, as in the other tabs, because the
// types say what a server should send and this checks what it did.
// ---------------------------------------------------------------------------
type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const ZONED = /(?:Z|[+-]\d{2}:\d{2})$/

function moment(problems: string[], where: string, v: unknown, required = false): void {
  if (v === null || v === undefined) {
    if (required) problems.push(`${where} is required`)
    return
  }
  if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) problems.push(`${where} is not an ISO 8601 date-time: ${JSON.stringify(v)}`)
  else if (!ZONED.test(v)) problems.push(`${where} has no time zone (end it in Z or +hh:mm): ${v}`)
}

function place(problems: string[], where: string, p: unknown): void {
  if (!isRec(p)) {
    problems.push(`${where} must be a place`)
    return
  }
  for (const k of ['latitude', 'longitude']) {
    if (p[k] !== null && p[k] !== undefined && typeof p[k] !== 'number') problems.push(`${where}.${k} must be a number`)
  }
}

/** Every way some data fails to be LoadPlanData, as sentences. Empty means it is. */
export function checkLoadPlans(data: unknown): string[] {
  if (!isRec(data)) return ['the plan data must be an object']
  for (const k of ['drivers', 'loads', 'stays']) if (!Array.isArray(data[k])) return [`${k} must be an array`]
  const problems: string[] = []
  moment(problems, 'asOf', data.asOf)

  const codes = new Set<string>()
  ;(data.drivers as unknown[]).forEach((d, i) => {
    if (!isRec(d) || typeof d.driverCode !== 'string' || !d.driverCode) {
      problems.push(`drivers[${i}] needs a driverCode`)
      return
    }
    codes.add(d.driverCode)
    place(problems, `drivers[${i}].home`, d.home)
    if (d.position !== null && d.position !== undefined) {
      place(problems, `drivers[${i}].position`, d.position)
      if (isRec(d.position)) moment(problems, `drivers[${i}].position.reportedAt`, d.position.reportedAt)
    }
  })

  const ids = new Set<string>()
  ;(data.loads as unknown[]).forEach((l, i) => {
    const at = `loads[${i}]${isRec(l) && typeof l.id === 'string' ? ` (${l.id})` : ''}`
    if (!isRec(l)) {
      problems.push(`${at} is not an object`)
      return
    }
    if (typeof l.id !== 'string' || !l.id) problems.push(`${at}.id is required`)
    else if (ids.has(l.id)) problems.push(`${at}.id is a duplicate`)
    else ids.add(l.id)
    if (!(LOAD_STATUSES as readonly unknown[]).includes(l.status)) problems.push(`${at}.status ${JSON.stringify(l.status)} is not one of ${LOAD_STATUSES.join(', ')}`)
    if (l.status === 'Available' && l.driverCode) problems.push(`${at} is Available but has a driver`)
    if ((l.status === 'Covered' || l.status === 'In Transit') && !l.driverCode) problems.push(`${at} is ${String(l.status)} with no driver`)
    place(problems, `${at}.origin`, l.origin)
    place(problems, `${at}.destination`, l.destination)
    for (const k of ['pickupStart', 'pickupEnd', 'deliveryStart', 'deliveryEnd', 'plannedAt']) moment(problems, `${at}.${k}`, l[k])
    if (l.status === 'Available' && l.plannedAt) problems.push(`${at} is Available but has a plannedAt`)
  })

  ;(data.stays as unknown[]).forEach((s, i) => {
    if (!isRec(s)) {
      problems.push(`stays[${i}] is not an object`)
      return
    }
    moment(problems, `stays[${i}].homeBy`, s.homeBy, true)
    moment(problems, `stays[${i}].backOut`, s.backOut, true)
    if (s.status !== 'APPROVED' && s.status !== 'HOME') problems.push(`stays[${i}].status must be APPROVED or HOME`)
  })
  return problems
}
