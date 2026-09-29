// ---------------------------------------------------------------------------
// THE CONTRACT: what the planner needs from whatever app it is running in.
//
// This file is the handshake between two codebases that cannot see each
// other. The load board fills it from its own API; the host app fills it
// from its own. The planner reads nothing else -- no URL, no token, no
// global -- so an adapter that returns a Roster is the whole integration.
//
// The types say what the shape IS. checkRoster says whether some data from
// the outside world actually HAS it -- types vanish at runtime, and JSON
// from a server is whatever the server sent. Run it over an adapter's
// output: an empty array means the planner will understand every field.
// fixtures/roster.json is a complete, valid example.
//
// Units, once more because they are the thing a port gets wrong:
//   durations   SECONDS
//   moments     ISO 8601 WITH A ZONE, "2026-09-29T17:00:00Z" or "...-05:00"
//   positions   decimal degrees, WGS84 -- what every GPS and map API uses
//
// No runtime imports. planHome.ts imports its types from here, never the
// other way round, so the two can be loaded by plain Node in any order.
// ---------------------------------------------------------------------------

export const JOB_TYPES = ['OTR', 'Regional', 'Dedicated', 'Local'] as const
export type JobType = (typeof JOB_TYPES)[number]

/** ISO 8601 date-time WITH a zone: "2026-09-29T17:00:00Z" or "2026-09-29T12:00:00-05:00". */
export type IsoMoment = string

/** A duration in seconds. */
export type Seconds = number

/** What an adapter hands the planner. Keep it STABLE -- module scope or
 * useMemo. A new adapter object every render is a new request every render. */
export interface Adapter {
  /** Every driver in one organisation -- the roster screens. `signal` aborts
   * when the module unmounts or asks again; pass it on to fetch or axios. */
  loadRoster(args: { organizationId: string | null; signal: AbortSignal }): Promise<Roster>
  /** One driver, as a roster of one -- the single-driver screens. Reads are
   * scoped per screen: a card about one driver does not fetch twenty. An
   * unknown driver is a roster with no drivers, not an error. */
  loadDriver(args: { organizationId: string | null; driverCode: string; signal: AbortSignal }): Promise<Roster>
}

export interface Roster {
  /** Plan as of this moment. Leave it out for live data (the planner uses the
   * clock); sample data pins it so the preview never drifts. */
  asOf?: IsoMoment
  /** The company's own limits. Anything left out falls back to DEFAULT_POLICY. */
  policy?: PolicyInput
  drivers: Driver[]
  /** Free text for whoever reads the file. Ignored. */
  about?: string
}

export interface PolicyInput {
  /** Days out before a driver is overdue home, by jobType. */
  maxDaysOut?: Partial<Record<JobType, number>>
  /** For a driver with no jobType, or one this does not know. */
  defaultMaxDaysOut?: number
  /** How many days before the limit counts as "due soon". */
  dueSoonDays?: number
}

/** One driver. Only driverCode, name, home and homeTime are required; every
 * other field may be null, and the planner says what it could not work out
 * rather than guessing. */
export interface Driver {
  /** Stable key for the driver. */
  driverCode: string
  name: string
  /** Picks the days-out limit. */
  jobType: JobType | null
  /** The truck, for display. */
  unitNo: string | null
  /** Where "home" is. Needs coordinates to be planned. */
  home: Place
  /** Where the truck last reported. */
  position: Position | null
  /** Hours-of-service clocks as they are NOW. */
  hours: Hours | null
  /** A load the driver must finish first. */
  currentLoad: CurrentLoad | null
  /** A real road route home, if the host has one. Measured from the load's
   * final stop when there is a currentLoad, otherwise from the position.
   * Without it the planner estimates (straight line x 1.2). */
  routeHome?: Route | null
  homeTime: HomeTime
}

export interface Place {
  /** "Cedar Rapids, IA" -- what a dispatcher reads. */
  place: string | null
  latitude: number | null
  longitude: number | null
}

export interface Position {
  /** "Kansas City, MO" */
  near: string | null
  latitude: number | null
  longitude: number | null
  /** When the truck said so. Older than two hours and the planner warns that
   * the truck has moved since. */
  reportedAt: IsoMoment | null
}

/** Seconds LEFT on each clock. Negative means over (treated as zero); null
 * means the ELD did not say. These are the names Geotab's
 * DutyStatusAvailability uses, converted from TimeSpan to seconds. */
export interface Hours {
  /** Left on the 11-hour driving limit. */
  driving: Seconds | null
  /** Left in the 14-hour on-duty window. */
  duty: Seconds | null
  /** Left in the 60/70-hour cycle. */
  cycle: Seconds | null
  /** Driving left before the 30-minute break is due. */
  rest?: Seconds | null
  /** Where the rule set has one. */
  workday?: Seconds | null
  /** "Driving", "Off duty" -- display only. */
  statusLabel?: string | null
}

export interface CurrentLoad {
  id: string
  /** The last delivery. The trip home starts here. */
  finalStop: Place
  /** When the truck will be empty at finalStop. */
  emptyAt: IsoMoment | null
  /** Clocks expected at emptyAt, if the host can project them. Without them
   * the trip home opens with a 10-hour rest. */
  hoursAtEmpty?: Hours | null
}

export interface Route {
  miles: number
  /** Driving time only; the planner adds the rest. */
  driveSeconds: Seconds
  /** "here-truck", "google", ... -- shown to the dispatcher. */
  source?: string
}

/** The home-time record. This is what the Driver Home Time Schedule keeps;
 * the planner only reads it. */
export interface HomeTime {
  /** When they were last home. Counts days out. */
  lastHomeAt: IsoMoment | null
  /** Home by this moment, if a request is open. */
  requestedBy: IsoMoment | null
  /** The reason, in the driver's words, if given. */
  note?: string | null
}

// ---------------------------------------------------------------------------
// Checking data from outside against all of that. Everything below takes
// `unknown`, because that is what a server response is until it has been
// looked at -- typing it as a Roster first would be the very assumption this
// exists to test.
// ---------------------------------------------------------------------------
type Rec = Record<string, unknown>

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const ZONED = /(?:Z|[+-]\d{2}:\d{2})$/

function checkMoment(problems: string[], where: string, value: unknown, { required = false } = {}): void {
  if (value === null || value === undefined) {
    if (required) problems.push(`${where} is required`)
    return
  }
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    problems.push(`${where} is not an ISO 8601 date-time: ${JSON.stringify(value)}`)
  } else if (!ZONED.test(value)) {
    problems.push(`${where} has no time zone (end it in Z or +hh:mm): ${value}`)
  }
}

function checkPlace(problems: string[], where: string, p: unknown, { required = false } = {}): void {
  if (p === null || p === undefined) {
    if (required) problems.push(`${where} is required`)
    return
  }
  if (!isRec(p)) {
    problems.push(`${where} must be an object`)
    return
  }
  for (const k of ['latitude', 'longitude']) {
    if (p[k] !== null && p[k] !== undefined && typeof p[k] !== 'number') {
      problems.push(`${where}.${k} must be a number, not ${JSON.stringify(p[k])}`)
    }
  }
}

function checkHours(problems: string[], where: string, h: unknown): void {
  if (h === null || h === undefined) return
  if (!isRec(h)) {
    problems.push(`${where} must be an object`)
    return
  }
  for (const k of ['driving', 'duty', 'cycle', 'rest', 'workday']) {
    const v = h[k]
    if (v !== null && v !== undefined && !(typeof v === 'number' && Number.isFinite(v))) {
      problems.push(`${where}.${k} must be seconds as a number, not ${JSON.stringify(v)}`)
    }
  }
  // The classic unit mistake: hours sent where seconds were wanted. Eleven
  // "seconds" of driving is a driver who cannot move.
  if (typeof h.driving === 'number' && h.driving > 0 && h.driving <= 14) {
    problems.push(`${where}.driving is ${h.driving} -- that looks like hours; the contract wants seconds`)
  }
}

// ---------------------------------------------------------------------------
// Every way some data fails to be a Roster, as sentences. An empty array
// means it is one. Meant for an adapter's tests and for a console line
// during the port -- not for the screen.
// ---------------------------------------------------------------------------
export function checkRoster(roster: unknown): string[] {
  if (!isRec(roster)) return ['the roster must be an object']
  if (!Array.isArray(roster.drivers)) return ['roster.drivers must be an array']

  const problems: string[] = []
  checkMoment(problems, 'roster.asOf', roster.asOf)

  const seen = new Set<string>()
  roster.drivers.forEach((d: unknown, i: number) => {
    const code = isRec(d) && typeof d.driverCode === 'string' && d.driverCode ? d.driverCode : null
    const at = `drivers[${i}]${code ? ` (${code})` : ''}`
    if (!isRec(d)) {
      problems.push(`${at} is not an object`)
      return
    }
    if (!code) problems.push(`${at}.driverCode is required`)
    else if (seen.has(code)) problems.push(`${at}.driverCode is a duplicate`)
    else seen.add(code)

    if (!d.name) problems.push(`${at}.name is required`)
    if (d.jobType && !(JOB_TYPES as readonly unknown[]).includes(d.jobType)) {
      problems.push(`${at}.jobType "${String(d.jobType)}" is not one of ${JOB_TYPES.join(', ')} -- the default days-out limit will be used`)
    }
    if (!isRec(d.home) || !d.home.place) problems.push(`${at}.home.place is required`)
    checkPlace(problems, `${at}.home`, d.home, { required: true })
    checkPlace(problems, `${at}.position`, d.position)
    if (isRec(d.position)) checkMoment(problems, `${at}.position.reportedAt`, d.position.reportedAt)
    checkHours(problems, `${at}.hours`, d.hours)

    if (isRec(d.currentLoad)) {
      checkPlace(problems, `${at}.currentLoad.finalStop`, d.currentLoad.finalStop, { required: true })
      checkMoment(problems, `${at}.currentLoad.emptyAt`, d.currentLoad.emptyAt)
      checkHours(problems, `${at}.currentLoad.hoursAtEmpty`, d.currentLoad.hoursAtEmpty)
    }
    if (isRec(d.routeHome)) {
      for (const k of ['miles', 'driveSeconds']) {
        if (typeof d.routeHome[k] !== 'number') problems.push(`${at}.routeHome.${k} must be a number`)
      }
    }

    if (!isRec(d.homeTime)) {
      problems.push(`${at}.homeTime is required (its fields may be null)`)
    } else {
      checkMoment(problems, `${at}.homeTime.lastHomeAt`, d.homeTime.lastHomeAt)
      checkMoment(problems, `${at}.homeTime.requestedBy`, d.homeTime.requestedBy)
    }
  })
  return problems
}
