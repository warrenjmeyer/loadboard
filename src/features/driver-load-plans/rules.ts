import type { HomeStay, Hours, IsoMoment, LoadPlanData, Place, PlanLoad } from './contract.ts'

// ---------------------------------------------------------------------------
// The Driver Load Plans rules. Pure, no runtime imports -- the same
// discipline as the other two tabs, and for the same reason: this is the part
// that has to mean the same thing after the port, and rules.test.ts proves it
// under plain `node --test`.
//
// THE HOURS MODEL IS HANDED IN, not imported. Whether a driver can reach a
// pickup depends on their hours -- 11/14/70, the breaks, the rests -- and
// that model lives in the Get Me Home Planner, which this folder may not
// import. So every function that times a leg takes a DriveFn: the host, which
// has both, passes one built on the planner's scheduleDrive (see
// src/features/preview/wiring.ts). Without one, a leg is plain driving time,
// and says so.
// ---------------------------------------------------------------------------

const HOUR = 3600

// No route from the host, so a straight line stretched by a fifth at 50 mph:
// the planner's estimate, so the two tabs measure a mile the same way.
export const ESTIMATE = { roadFactor: 1.2, mph: 50 } as const

// Reaching a pickup with less than two hours of its window left is TIGHT:
// one closed ramp and the load is late.
export const TIGHT_SECONDS = 2 * HOUR

export const BOARD_DAYS = 7

// A 34-hour stay is a restart: every clock is full again when it ends.
// (The same rule the planner's model applies on the road.)
export const RESTART_SECONDS = 34 * HOUR
export const FRESH_HOURS: Hours = { driving: 11 * HOUR, duty: 14 * HOUR, cycle: 70 * HOUR, rest: 8 * HOUR }

function ms(v: IsoMoment | null | undefined): number | null {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

const iso = (t: number): IsoMoment => new Date(t).toISOString()

function placeable(p: Place | null | undefined): p is Place & { latitude: number; longitude: number } {
  return !!p && typeof p.latitude === 'number' && typeof p.longitude === 'number'
    && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && !(p.latitude === 0 && p.longitude === 0)
}

/** Great-circle miles, or null when either end cannot be placed. */
export function milesBetween(a: Place | null | undefined, b: Place | null | undefined): number | null {
  if (!placeable(a) || !placeable(b)) return null
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.latitude - a.latitude)
  const dLon = rad(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 2 * 3958.8 * Math.asin(Math.sqrt(h))
}

/** The empty miles from one place to the next, and the driving they take. */
export function deadhead(from: Place | null | undefined, to: Place | null | undefined): { miles: number; driveSeconds: number } | null {
  const straight = milesBetween(from, to)
  if (straight === null) return null
  const miles = Math.round(straight * ESTIMATE.roadFactor)
  return { miles, driveSeconds: Math.round((miles / ESTIMATE.mph) * HOUR) }
}

// ---------------------------------------------------------------------------
// Timing a drive. A DriveFn lays `driveSeconds` of driving out against a
// driver's KNOWN hours from `startAt`, and says when they arrive and how long
// they stopped on the way. It is only ever called with hours: where nobody
// knows a driver's hours, a leg is plain driving time and says why.
// ---------------------------------------------------------------------------
export interface DriveResult {
  arriveAt: IsoMoment
  /** Breaks, rests and restarts on the way. */
  restSeconds: number
  /** False when the times are plain driving, with no hours model behind them. */
  hoursConsidered: boolean
}

export type DriveFn = (args: { driveSeconds: number; hours: Hours; startAt: IsoMoment }) => DriveResult | null

function plain(driveSeconds: number, startAt: IsoMoment): DriveResult | null {
  const t = ms(startAt)
  return t === null ? null : { arriveAt: iso(t + driveSeconds * 1000), restSeconds: 0, hoursConsidered: false }
}

/** No hours model: arrive as soon as the driving is done. Says so. */
export const plainDrive: DriveFn = ({ driveSeconds, startAt }) => plain(driveSeconds, startAt)

// ---------------------------------------------------------------------------
// A driver's plan: the loads on their truck and lined up for it, the one
// under way first, then by pickup.
// ---------------------------------------------------------------------------
const ON_PLAN: readonly string[] = ['In Transit', 'Covered']

export function planFor(data: LoadPlanData, driverCode: string): PlanLoad[] {
  return data.loads
    .filter((l) => l.driverCode === driverCode && ON_PLAN.includes(l.status))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'In Transit' ? -1 : 1
      const pa = ms(a.pickupStart) ?? ms(a.pickupEnd)
      const pb = ms(b.pickupStart) ?? ms(b.pickupEnd)
      // Compared, not subtracted: Infinity - Infinity is NaN, and NaN sorts nowhere.
      if (pa !== pb) return pa === null ? 1 : pb === null ? -1 : pa - pb
      return a.id.localeCompare(b.id)
    })
}

/** When a load's truck is empty again: the end of its delivery window. */
export function emptyAt(load: PlanLoad): number | null {
  return ms(load.deliveryEnd) ?? ms(load.deliveryStart)
}

/** The latest a truck can reach the pickup: the end of its window. */
export function pickupCloses(load: PlanLoad): number | null {
  return ms(load.pickupEnd) ?? ms(load.pickupStart)
}

/** The time a load occupies, from its pickup to its delivery. */
export function loadSpan(load: PlanLoad): { start: number; end: number } | null {
  const start = ms(load.pickupStart) ?? ms(load.pickupEnd) ?? ms(load.deliveryStart)
  const end = ms(load.deliveryEnd) ?? ms(load.deliveryStart) ?? ms(load.pickupEnd) ?? start
  return start === null || end === null ? null : { start, end: Math.max(start, end) }
}

export function staySpan(stay: HomeStay): { start: number; end: number } | null {
  const start = ms(stay.homeBy)
  const end = ms(stay.backOut)
  return start === null || end === null ? null : { start, end: Math.max(start, end) }
}

const overlap = (a: { start: number; end: number } | null, b: { start: number; end: number } | null) =>
  a !== null && b !== null && a.start < b.end && a.end > b.start

/** The approved or current stays a load would run into for this driver. */
export function conflictsWith(load: PlanLoad, driverCode: string, stays: readonly HomeStay[]): HomeStay[] {
  const span = loadSpan(load)
  return stays.filter((s) => s.driverCode === driverCode && overlap(span, staySpan(s)))
}

// ---------------------------------------------------------------------------
// WHERE A LEG STARTS. For a driver and a load, the truck sets off from the
// latest of:
//
//   - where it is now, with the hours GeoTab reports;
//   - where a planned load delivers, when its delivery window closes, if that
//     is before this pickup closes -- hours after it unknown;
//   - home, when an approved or current stay ends, if that is before this
//     pickup closes -- with full hours if the stay was a restart (34 h).
//
// So a driver at home starts from home when their stay ends, and a driver
// with loads lined up takes the next one from where the last one leaves them.
// ---------------------------------------------------------------------------
export type StartKind = { kind: 'now' } | { kind: 'load'; loadId: string } | { kind: 'home'; backOut: IsoMoment }

export interface LegStart {
  place: Place | null
  readyAt: number
  hours: Hours | null
  after: StartKind
}

export function startFor(data: LoadPlanData, driverCode: string, target: PlanLoad, nowMs: number): LegStart {
  const driver = data.drivers.find((d) => d.driverCode === driverCode)
  const closes = pickupCloses(target) ?? Infinity
  // Compared by when each really ends; set off no earlier than now.
  let at = nowMs
  let best: LegStart = { place: driver?.position ?? null, readyAt: nowMs, hours: driver?.hours ?? null, after: { kind: 'now' } }
  const consider = (end: number, start: Omit<LegStart, 'readyAt'>) => {
    if (end <= closes && end > at) {
      at = end
      best = { ...start, readyAt: Math.max(end, nowMs) }
    }
  }
  for (const load of planFor(data, driverCode)) {
    const e = emptyAt(load)
    if (load.id !== target.id && e !== null) consider(e, { place: load.destination, hours: null, after: { kind: 'load', loadId: load.id } })
  }
  for (const stay of data.stays) {
    const span = stay.driverCode === driverCode ? staySpan(stay) : null
    if (span) {
      consider(span.end, {
        place: driver?.home ?? null,
        hours: span.end - span.start >= RESTART_SECONDS * 1000 ? FRESH_HOURS : null,
        after: { kind: 'home', backOut: stay.backOut },
      })
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// THE LEG INTO A LOAD: from where the truck sets off to the load's pickup --
// how far empty, when it gets there, and whether that is inside the window.
// ---------------------------------------------------------------------------
export type LegVerdict = 'ON_TIME' | 'TIGHT' | 'LATE' | 'UNKNOWN'

export interface Leg {
  from: Place | null
  to: Place
  after: StartKind
  readyAt: IsoMoment
  deadheadMiles: number | null
  driveSeconds: number | null
  restSeconds: number
  arriveAt: IsoMoment | null
  hoursConsidered: boolean
  /** Why the times are driving only, in words; null when hours were counted. */
  timingNote: string | null
  /** To the end of the pickup window; negative is late. Null without a window. */
  slackSeconds: number | null
  verdict: LegVerdict
  /** Why the verdict is UNKNOWN, in words. */
  unknownBecause: string | null
}

function timingNote(start: LegStart, timed: DriveResult | null): string | null {
  if (!timed || timed.hoursConsidered) return null
  if (start.hours) return 'Driving time only: no hours model was given.'
  switch (start.after.kind) {
    case 'load': return `Driving time only: hours after ${start.after.loadId} are not known yet.`
    case 'home': return 'Driving time only: hours after a short stay at home are not known.'
    default: return 'Driving time only: GeoTab has no hours for this driver.'
  }
}

export function legTo(target: PlanLoad, start: LegStart, drive: DriveFn = plainDrive): Leg {
  const base = { from: start.place, to: target.origin, after: start.after, readyAt: iso(start.readyAt) }
  const dh = deadhead(start.place, target.origin)
  if (!dh) {
    return {
      ...base, deadheadMiles: null, driveSeconds: null, restSeconds: 0, arriveAt: null,
      hoursConsidered: false, timingNote: null, slackSeconds: null, verdict: 'UNKNOWN',
      unknownBecause: placeable(start.place)
        ? `${target.origin.place || 'The pickup'} has no map position.`
        : start.after.kind === 'home' ? 'The driver\'s home has no map position.' : 'Nothing reports where the truck is.',
    }
  }
  const startAt = iso(start.readyAt)
  const timed = start.hours ? drive({ driveSeconds: dh.driveSeconds, hours: start.hours, startAt }) : plain(dh.driveSeconds, startAt)
  const arrive = timed ? ms(timed.arriveAt) : null
  const closes = pickupCloses(target)
  const slack = arrive !== null && closes !== null ? Math.round((closes - arrive) / 1000) : null
  return {
    ...base,
    deadheadMiles: dh.miles,
    driveSeconds: dh.driveSeconds,
    restSeconds: timed ? timed.restSeconds : 0,
    arriveAt: arrive === null ? null : iso(arrive),
    hoursConsidered: timed ? timed.hoursConsidered : false,
    timingNote: timingNote(start, timed),
    slackSeconds: slack,
    // No window at all is not late: nobody set a time to miss.
    verdict: arrive === null ? 'UNKNOWN' : slack === null ? 'ON_TIME' : slack < 0 ? 'LATE' : slack < TIGHT_SECONDS ? 'TIGHT' : 'ON_TIME',
    unknownBecause: arrive === null ? 'The times could not be worked out.' : null,
  }
}

// ---------------------------------------------------------------------------
// A plan laid out: each load, the leg into it, the stays it runs into, and
// any other load of theirs it overlaps. The load under way has no leg -- it
// is being driven.
// ---------------------------------------------------------------------------
export interface PlannedLoad {
  load: PlanLoad
  leg: Leg | null
  conflicts: HomeStay[]
  /** Another of this driver's loads occupying the same time. */
  overlapsLoad: string | null
}

export function planWithLegs(data: LoadPlanData, driverCode: string, { now, drive = plainDrive }: { now: IsoMoment; drive?: DriveFn }): PlannedLoad[] {
  const nowMs = ms(now) ?? Date.now()
  const plan = planFor(data, driverCode)
  return plan.map((load) => ({
    load,
    leg: load.status === 'In Transit' ? null : legTo(load, startFor(data, driverCode, load, nowMs), drive),
    conflicts: conflictsWith(load, driverCode, data.stays),
    overlapsLoad: plan.find((o) => o.id !== load.id && overlap(loadSpan(o), loadSpan(load)))?.id ?? null,
  }))
}

/** A plan's totals, for a row on the board or a heading. */
export interface PlanSummary {
  loads: number
  loadedMiles: number
  deadheadMiles: number
  late: number
  tight: number
  /** Loads that run into home time or another load. */
  clashes: number
}

export function summarize(planned: readonly PlannedLoad[]): PlanSummary {
  return planned.reduce<PlanSummary>((s, p) => ({
    loads: s.loads + 1,
    loadedMiles: s.loadedMiles + (p.load.miles ?? 0),
    deadheadMiles: s.deadheadMiles + (p.leg?.deadheadMiles ?? 0),
    late: s.late + (p.leg?.verdict === 'LATE' ? 1 : 0),
    tight: s.tight + (p.leg?.verdict === 'TIGHT' ? 1 : 0),
    clashes: s.clashes + (p.conflicts.length > 0 || p.overlapsLoad ? 1 : 0),
  }), { loads: 0, loadedMiles: 0, deadheadMiles: 0, late: 0, tight: 0, clashes: 0 })
}

// ---------------------------------------------------------------------------
// SUGGESTING A DRIVER for an open load: every driver, ranked -- first the
// ones who can take it (free then, reaching the pickup inside its window, not
// running into their home time), and among those the fewest empty miles.
// Empty miles are what dispatch is paid to keep down; a TIGHT arrival is
// still an arrival, and it is marked as one.
// ---------------------------------------------------------------------------
export interface Candidate {
  driverCode: string
  name: string
  unitNo: string | null
  leg: Leg
  /** A load of theirs already occupying that time. */
  busyWith: string | null
  conflicts: HomeStay[]
  /** Free, reachable in the window, and clear of home time. */
  canTake: boolean
}

const VERDICT_ORDER: Record<LegVerdict, number> = { ON_TIME: 0, TIGHT: 1, LATE: 2, UNKNOWN: 3 }

export function suggestDrivers(data: LoadPlanData, loadId: string, { now, drive = plainDrive }: { now: IsoMoment; drive?: DriveFn }): Candidate[] {
  const open = data.loads.find((l) => l.id === loadId)
  if (!open || open.status !== 'Available') return []
  const nowMs = ms(now) ?? Date.now()
  const span = loadSpan(open)

  return data.drivers.map((driver): Candidate => {
    const busy = planFor(data, driver.driverCode).find((l) => overlap(loadSpan(l), span))
    const leg = legTo(open, startFor(data, driver.driverCode, open, nowMs), drive)
    const conflicts = conflictsWith(open, driver.driverCode, data.stays)
    return {
      driverCode: driver.driverCode,
      name: driver.name,
      unitNo: driver.unitNo,
      leg,
      busyWith: busy ? busy.id : null,
      conflicts,
      canTake: !busy && conflicts.length === 0 && (leg.verdict === 'ON_TIME' || leg.verdict === 'TIGHT'),
    }
  }).sort((a, b) =>
    Number(b.canTake) - Number(a.canTake)
    || compareMiles(a.leg.deadheadMiles, b.leg.deadheadMiles)
    || VERDICT_ORDER[a.leg.verdict] - VERDICT_ORDER[b.leg.verdict]
    || a.name.localeCompare(b.name))
}

// Nearest first; no distance at all goes last.
function compareMiles(a: number | null, b: number | null): number {
  if (a === b) return 0
  return a === null ? 1 : b === null ? -1 : a - b
}

/** Why a candidate cannot take it, in words; null when they can. */
export function whyNot(c: Candidate): string | null {
  if (c.canTake) return null
  if (c.busyWith) return `Busy with ${c.busyWith} then.`
  if (c.conflicts.length > 0) return 'It runs into their home time.'
  if (c.leg.verdict === 'LATE') return 'Cannot reach the pickup in its window.'
  return c.leg.unknownBecause || 'Cannot tell whether they reach the pickup.'
}

// ---------------------------------------------------------------------------
// What may be put on a plan, and taken off. Returns the load as it is after,
// or a sentence saying why not -- the same answer the server gives.
// ---------------------------------------------------------------------------
export function assign(load: PlanLoad, driverCode: string): { load: PlanLoad } | { error: string } {
  if (!driverCode) return { error: 'Choose a driver.' }
  if (load.status !== 'Available') {
    return { error: `${load.id} is ${load.status}${load.driverCode ? ` with ${load.driverCode}` : ''} now, not Available.` }
  }
  return { load: { ...load, status: 'Covered', driverCode } }
}

export function unassign(load: PlanLoad): { load: PlanLoad } | { error: string } {
  if (load.status === 'In Transit') return { error: `${load.id} is already under way; it cannot come off the plan.` }
  if (load.status !== 'Covered') return { error: `${load.id} is not on anyone's plan.` }
  return { load: { ...load, status: 'Available', driverCode: null } }
}

// ---------------------------------------------------------------------------
// The board: a week from midnight today, in the VIEWER's zone -- a dispatcher
// plans on their own calendar, as everywhere in these tabs.
// ---------------------------------------------------------------------------
export interface BoardDay { start: number; end: number; weekend: boolean }
export interface BoardWindow { start: number; end: number; days: BoardDay[] }

export function boardWindow(now: IsoMoment, { days = BOARD_DAYS }: { days?: number } = {}): BoardWindow {
  const at = new Date(ms(now) ?? Date.now())
  const list: BoardDay[] = []
  for (let i = 0; i < days; i += 1) {
    // Calendar parts, not 24-hour steps: a day with a clock change is not 24 hours.
    const s = new Date(at.getFullYear(), at.getMonth(), at.getDate() + i)
    const e = new Date(at.getFullYear(), at.getMonth(), at.getDate() + i + 1)
    list.push({ start: s.getTime(), end: e.getTime(), weekend: s.getDay() === 0 || s.getDay() === 6 })
  }
  return { start: list[0]!.start, end: list[list.length - 1]!.end, days: list }
}

export interface BarPlace { left: number; width: number; clippedStart: boolean; clippedEnd: boolean }

/** Where a span sits on the window, as fractions; null when it misses it. */
export function barFor(span: { start: number; end: number } | null, window: BoardWindow): BarPlace | null {
  if (!span || span.end <= window.start || span.start >= window.end) return null
  const len = window.end - window.start
  const from = Math.max(span.start, window.start)
  const to = Math.min(span.end, window.end)
  return { left: (from - window.start) / len, width: (to - from) / len, clippedStart: span.start < window.start, clippedEnd: span.end > window.end }
}

export function positionOf(moment: IsoMoment, window: BoardWindow): number | null {
  const t = ms(moment)
  if (t === null || t < window.start || t > window.end) return null
  return (t - window.start) / (window.end - window.start)
}

/** For each day on the board, how many drivers have nothing on it -- no load,
 * no home time. The question a week of plans is for: who can take more? */
export function freeCounts(data: LoadPlanData, window: BoardWindow): number[] {
  return window.days.map((day) => data.drivers.filter((d) =>
    !planFor(data, d.driverCode).some((l) => overlap(loadSpan(l), day))
    && !data.stays.some((s) => s.driverCode === d.driverCode && overlap(staySpan(s), day))).length)
}

/** Whether an open load picks up inside [from, to): its pickup window touches
 * it. What loadOpenLoads keeps, and what a piece holding more data cuts to. */
export function picksUpWithin(load: PlanLoad, from: IsoMoment, to: IsoMoment): boolean {
  const start = ms(load.pickupStart) ?? ms(load.pickupEnd)
  const end = ms(load.pickupEnd) ?? ms(load.pickupStart)
  // A window given as one moment is a moment inside it, not nothing: +1 ms.
  return load.status === 'Available' && start !== null && end !== null && touches({ start, end: Math.max(start, end) + 1 }, from, to)
}

/** Whether a span touches [from, to) -- what the board and open-load reads keep. */
export function touches(span: { start: number; end: number } | null, from: IsoMoment, to: IsoMoment): boolean {
  const a = ms(from)
  const b = ms(to)
  return span !== null && a !== null && b !== null && span.start < b && span.end > a
}
