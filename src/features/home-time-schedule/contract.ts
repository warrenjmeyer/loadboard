// ---------------------------------------------------------------------------
// THE CONTRACT for the Driver Home Time Schedule: what it needs from the app
// it runs in, and what it asks that app to do.
//
// One record is one STAY -- a driver's time at home, from asking for it to
// driving away again:
//
//   REQUESTED  the driver asked                     (driver)
//   APPROVED   dispatch said yes                    (dispatch)
//   HOME       the driver got there                 (dispatch, later GeoTab)
//   DONE       the driver left again                (dispatch, later GeoTab)
//   DECLINED   dispatch said no, and why            (dispatch)
//   CANCELLED  withdrawn before it happened         (either)
//
// The statuses are the rows of a lookup table the stakeholder creates through
// the app, matched by name, as the planner's are -- see the README.
//
// Same units as the planner: moments are ISO 8601 WITH A ZONE. A stay's
// times are the ones the driver asked for; arrivedAt and leftAt are what
// happened. The two are kept apart because "late home" is the difference.
//
// No runtime imports, so plain Node can load it, and so it moves on its own.
// ---------------------------------------------------------------------------

/** ISO 8601 date-time WITH a zone. */
export type IsoMoment = string

export const STAY_STATUSES = ['REQUESTED', 'APPROVED', 'HOME', 'DONE', 'DECLINED', 'CANCELLED'] as const
export type StayStatus = (typeof STAY_STATUSES)[number]

export interface Stay {
  id: string
  driverCode: string
  /** Home by this moment -- what the driver asked for, and what the planner checks. */
  homeBy: IsoMoment
  /** Available to drive again from this moment. */
  backOut: IsoMoment
  status: StayStatus
  /** The reason, in the driver's words. */
  note: string | null
  requestedAt: IsoMoment
  /** When dispatch approved or declined, and who. */
  decidedAt: IsoMoment | null
  decidedBy: string | null
  /** Required when DECLINED: a driver told "no" is owed a reason. */
  declineReason: string | null
  /** What actually happened. Set on HOME and DONE. */
  arrivedAt: IsoMoment | null
  leftAt: IsoMoment | null
}

export interface ScheduleDriver {
  driverCode: string
  name: string
  unitNo: string | null
}

export interface ScheduleData {
  /** Pin the clock (sample data). Leave it out for live data. */
  asOf?: IsoMoment
  drivers: ScheduleDriver[]
  stays: Stay[]
  about?: string
}

/** What a driver fills in. Everything else is the app's to set. */
export interface NewStay {
  driverCode: string
  homeBy: IsoMoment
  backOut: IsoMoment
  note: string | null
}

export type StayAction =
  | { type: 'approve' }
  | { type: 'decline'; reason: string }
  | { type: 'cancel' }
  | { type: 'arrive'; at?: IsoMoment }
  | { type: 'leave'; at?: IsoMoment }

/** What the planner thinks of a stay, shown beside Approve so nobody agrees
 * to a promise the hours cannot keep. The schedule does not know the planner:
 * the host, which has both, passes a function that returns one of these. */
export interface StayVerdict {
  severity: 'success' | 'info' | 'warning' | 'error'
  text: string
}

/** What the schedule needs from the host. Keep it STABLE (module scope or
 * useMemo), as with the planner's adapter. The host decides who may do what:
 * the schedule only offers each action where the status allows it. */
export interface ScheduleAdapter {
  loadSchedule(args: { organizationId: string | null; signal: AbortSignal }): Promise<ScheduleData>
  /** A driver's request. Resolves to the stored stay, id and all. */
  requestStay(stay: NewStay): Promise<Stay>
  /** Dispatch or the driver acting on a stay. Resolves to it as stored after. */
  actOnStay(id: string, action: StayAction): Promise<Stay>
}

// ---------------------------------------------------------------------------
// Checking data from outside -- `unknown`, like the planner's checkRoster,
// because the types say what a server should send and this checks what it did.
// ---------------------------------------------------------------------------
type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const ZONED = /(?:Z|[+-]\d{2}:\d{2})$/

function checkMoment(problems: string[], where: string, v: unknown, required: boolean): void {
  if (v === null || v === undefined) {
    if (required) problems.push(`${where} is required`)
    return
  }
  if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) problems.push(`${where} is not an ISO 8601 date-time: ${JSON.stringify(v)}`)
  else if (!ZONED.test(v)) problems.push(`${where} has no time zone (end it in Z or +hh:mm): ${v}`)
}

// Every way some data fails to be ScheduleData, as sentences. Empty means it is.
export function checkSchedule(data: unknown): string[] {
  if (!isRec(data)) return ['the schedule must be an object']
  if (!Array.isArray(data.drivers)) return ['schedule.drivers must be an array']
  if (!Array.isArray(data.stays)) return ['schedule.stays must be an array']

  const problems: string[] = []
  checkMoment(problems, 'schedule.asOf', data.asOf, false)

  const codes = new Set<string>()
  data.drivers.forEach((d: unknown, i: number) => {
    if (!isRec(d) || typeof d.driverCode !== 'string' || !d.driverCode) problems.push(`drivers[${i}] needs a driverCode`)
    else codes.add(d.driverCode)
    if (isRec(d) && !d.name) problems.push(`drivers[${i}] needs a name`)
  })

  const ids = new Set<string>()
  data.stays.forEach((s: unknown, i: number) => {
    const at = `stays[${i}]${isRec(s) && typeof s.id === 'string' ? ` (${s.id})` : ''}`
    if (!isRec(s)) {
      problems.push(`${at} is not an object`)
      return
    }
    if (typeof s.id !== 'string' || !s.id) problems.push(`${at}.id is required`)
    else if (ids.has(s.id)) problems.push(`${at}.id is a duplicate`)
    else ids.add(s.id)

    if (typeof s.driverCode !== 'string' || !codes.has(s.driverCode)) problems.push(`${at}.driverCode ${JSON.stringify(s.driverCode)} is not one of the drivers`)
    if (!(STAY_STATUSES as readonly unknown[]).includes(s.status)) problems.push(`${at}.status ${JSON.stringify(s.status)} is not one of ${STAY_STATUSES.join(', ')}`)

    checkMoment(problems, `${at}.homeBy`, s.homeBy, true)
    checkMoment(problems, `${at}.backOut`, s.backOut, true)
    checkMoment(problems, `${at}.requestedAt`, s.requestedAt, true)
    checkMoment(problems, `${at}.decidedAt`, s.decidedAt, false)
    checkMoment(problems, `${at}.arrivedAt`, s.arrivedAt, s.status === 'HOME' || s.status === 'DONE')
    checkMoment(problems, `${at}.leftAt`, s.leftAt, s.status === 'DONE')

    if (typeof s.homeBy === 'string' && typeof s.backOut === 'string' && Date.parse(s.backOut) <= Date.parse(s.homeBy)) {
      problems.push(`${at}.backOut is not after homeBy`)
    }
    if (s.status === 'DECLINED' && !s.declineReason) problems.push(`${at} is DECLINED with no declineReason`)
  })
  return problems
}
