import type { IsoMoment, NewStay, Stay, StayAction, StaySource, StayStatus } from './contract.ts'

// ---------------------------------------------------------------------------
// The schedule's rules. Pure, no runtime imports -- the planner's discipline,
// for the same reason: this is the part that must mean the same thing after
// the port, and rules.test.ts proves it under plain `node --test`.
// ---------------------------------------------------------------------------

function ms(v: IsoMoment | null | undefined): number | null {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

const iso = (t: number): IsoMoment => new Date(t).toISOString()

// ---------------------------------------------------------------------------
// Who may move a stay where. Each action has one destination and a short
// list of places it may start from; anything else is refused with a reason.
// There is no way back: a DONE stay is history, a DECLINED one is answered,
// and a change of plan is a new request -- which keeps the record of what
// was asked and what was said.
//
// `correct` is the one move that goes nowhere: it fixes the arrival or
// departure GeoTab (or somebody) recorded, and leaves the status alone.
// ---------------------------------------------------------------------------
export const MOVES: Readonly<Record<StayAction['type'], { from: readonly StayStatus[]; to: StayStatus | null; label: string }>> = {
  approve: { from: ['REQUESTED'], to: 'APPROVED', label: 'Approve' },
  decline: { from: ['REQUESTED'], to: 'DECLINED', label: 'Decline' },
  cancel: { from: ['REQUESTED', 'APPROVED'], to: 'CANCELLED', label: 'Cancel' },
  arrive: { from: ['APPROVED'], to: 'HOME', label: 'Arrived home' },
  leave: { from: ['HOME'], to: 'DONE', label: 'Left home' },
  correct: { from: ['HOME', 'DONE'], to: null, label: 'Correct times' },
}

/** The actions a stay in this status allows, in the order a screen offers them. */
export function actionsFor(status: StayStatus): StayAction['type'][] {
  return (Object.keys(MOVES) as StayAction['type'][]).filter((t) => MOVES[t].from.includes(status))
}

// ---------------------------------------------------------------------------
// Apply one action. Returns the stay as it is after, or a sentence saying why
// not -- never a half-changed stay. `by` is who did it, for decidedBy;
// `source` is who SAW an arrival or departure -- GeoTab, when the automatic
// check applies a move, or dispatch, who clicked. Corrections are always
// dispatch's, whatever was there before.
// ---------------------------------------------------------------------------
export function applyAction(stay: Stay, action: StayAction, { now, by, source = 'DISPATCH' }: {
  now: IsoMoment
  by: string | null
  source?: StaySource
}): { stay: Stay } | { error: string } {
  const move = MOVES[action.type]
  if (!move.from.includes(stay.status)) {
    return {
      error: move.to
        ? `A ${stay.status.toLowerCase()} stay cannot be ${move.to.toLowerCase()}.`
        : `A ${stay.status.toLowerCase()} stay has no arrival or departure to correct.`,
    }
  }
  const next: Stay = { ...stay, status: move.to ?? stay.status }

  switch (action.type) {
    case 'approve':
      return { stay: { ...next, decidedAt: now, decidedBy: by } }
    case 'decline': {
      const reason = action.reason.trim()
      if (!reason) return { error: 'Say why. A driver told no is owed a reason.' }
      return { stay: { ...next, decidedAt: now, decidedBy: by, declineReason: reason } }
    }
    case 'cancel':
      return { stay: next }
    case 'arrive':
      return { stay: { ...next, arrivedAt: action.at || now, arrivedSource: source } }
    case 'leave': {
      const at = action.at || now
      const arrived = ms(stay.arrivedAt)
      const left = ms(at)
      if (arrived !== null && left !== null && left < arrived) return { error: 'Left home before arriving?' }
      return { stay: { ...next, leftAt: at, leftSource: source } }
    }
    case 'correct': {
      if (action.leftAt && stay.status !== 'DONE') return { error: 'They have not left yet, so there is no departure to correct.' }
      const arrivedAt = action.arrivedAt || stay.arrivedAt
      const leftAt = action.leftAt || stay.leftAt
      const a = ms(arrivedAt)
      const l = ms(leftAt)
      const n = ms(now)
      if (a === null) return { error: 'When did they get home?' }
      if (n !== null && (a > n || (l !== null && l > n))) return { error: 'That time has not happened yet.' }
      if (l !== null && l < a) return { error: 'Left home before arriving?' }
      return {
        stay: {
          ...next,
          arrivedAt,
          leftAt,
          arrivedSource: action.arrivedAt ? 'DISPATCH' : stay.arrivedSource ?? null,
          leftSource: action.leftAt ? 'DISPATCH' : stay.leftSource ?? null,
        },
      }
    }
  }
}

// Statuses whose time at home is planned or real, and so occupies the
// calendar. DECLINED and CANCELLED never happened.
const OCCUPIES: readonly StayStatus[] = ['REQUESTED', 'APPROVED', 'HOME', 'DONE']

// When a stay really begins and ends: what happened, where it has.
function span(stay: Stay): { start: number; end: number } | null {
  const start = ms(stay.arrivedAt) ?? ms(stay.homeBy)
  const end = ms(stay.leftAt) ?? ms(stay.backOut)
  if (start === null || end === null) return null
  return { start, end: Math.max(start, end) }
}

/** Whether a stay occupies the calendar anywhere between two moments -- the
 * test the board's read applies. DECLINED and CANCELLED never do. */
export function overlaps(stay: Stay, from: IsoMoment, to: IsoMoment): boolean {
  if (!OCCUPIES.includes(stay.status)) return false
  const s = span(stay)
  const a = ms(from)
  const b = ms(to)
  return s !== null && a !== null && b !== null && s.start < b && s.end > a
}

// ---------------------------------------------------------------------------
// Every reason a driver's request cannot be taken, as sentences. Empty means
// it can. The driver sees these before anything is sent.
// ---------------------------------------------------------------------------
export function checkNewStay(stay: NewStay, existing: readonly Stay[], { now }: { now: IsoMoment }): string[] {
  const problems: string[] = []
  const homeBy = ms(stay.homeBy)
  const backOut = ms(stay.backOut)
  const nowMs = ms(now) ?? Date.now()

  if (homeBy === null) problems.push('When do you want to be home by?')
  if (backOut === null) problems.push('When can you drive again?')
  if (homeBy !== null && homeBy <= nowMs) problems.push('"Home by" has to be in the future.')
  if (homeBy !== null && backOut !== null && backOut <= homeBy) problems.push('"Back out" has to be after "home by".')
  if (problems.length > 0) return problems

  // One stay at a time: two requests for the same days are one request asked
  // twice, and dispatch would have to guess which one to answer.
  const clash = existing.find((s) => {
    if (s.driverCode !== stay.driverCode || !OCCUPIES.includes(s.status) || s.status === 'DONE') return false
    const other = span(s)
    return other !== null && homeBy! < other.end && backOut! > other.start
  })
  if (clash) {
    problems.push(`That overlaps a stay you already have (${clash.status.toLowerCase()}). Cancel that one first, or pick other days.`)
  }
  return problems
}

// ---------------------------------------------------------------------------
// WHAT THE PLANNER NEEDS, and the reason this tab exists: for one driver,
// when they were last home and when they have asked to be home by.
//
//   at home now (HOME)       lastHomeAt = now -- they are home, out 0 days
//   otherwise                lastHomeAt = when they last LEFT home (latest DONE)
//   requestedBy              the earliest home-by among REQUESTED and APPROVED
//
// The shape is the planner's HomeTime field for field. It is written out here
// rather than imported so each folder moves on its own; TypeScript checks
// that the two still agree wherever both are used together.
// ---------------------------------------------------------------------------
export interface PlannerHomeTime {
  lastHomeAt: IsoMoment | null
  requestedBy: IsoMoment | null
  note: string | null
}

export function homeTimeFor(stays: readonly Stay[], driverCode: string, now: IsoMoment): PlannerHomeTime {
  const mine = stays.filter((s) => s.driverCode === driverCode)

  const lastLeft = mine
    .filter((s) => s.status === 'DONE' && ms(s.leftAt) !== null)
    .reduce<Stay | null>((best, s) => (!best || ms(s.leftAt)! > ms(best.leftAt)! ? s : best), null)
  const atHome = mine.some((s) => s.status === 'HOME')

  const open = mine
    .filter((s) => s.status === 'REQUESTED' || s.status === 'APPROVED')
    .sort((a, b) => (ms(a.homeBy) ?? Infinity) - (ms(b.homeBy) ?? Infinity))[0] || null

  return {
    lastHomeAt: atHome ? now : lastLeft ? lastLeft.leftAt : null,
    requestedBy: open ? open.homeBy : null,
    note: open ? open.note : null,
  }
}

/** Requests waiting on dispatch, oldest first: whoever has waited longest is answered first. */
export function needsDecision(stays: readonly Stay[]): Stay[] {
  return stays
    .filter((s) => s.status === 'REQUESTED')
    .sort((a, b) => (ms(a.requestedAt) ?? 0) - (ms(b.requestedAt) ?? 0))
}

// ---------------------------------------------------------------------------
// The board: a run of days, and where each stay sits on it.
//
// Days begin at midnight in the VIEWER's zone -- the dispatcher reads their
// own calendar, as with every time the planner shows. So this depends on
// where it runs, and the tests check shapes rather than exact instants.
// ---------------------------------------------------------------------------
export interface BoardDay {
  start: number
  end: number
  /** Saturday or Sunday, which the board shades. */
  weekend: boolean
}

export interface BoardWindow {
  start: number
  end: number
  days: BoardDay[]
}

export function boardWindow(now: IsoMoment, { daysBefore = 3, days = 14 } = {}): BoardWindow {
  const at = new Date(ms(now) ?? Date.now())
  // Midnight today, then back; built from calendar parts, not by subtracting
  // 24-hour days, because a day with a clock change is 23 or 25 hours long.
  const first = new Date(at.getFullYear(), at.getMonth(), at.getDate() - daysBefore)
  const list: BoardDay[] = []
  for (let i = 0; i < days; i += 1) {
    const s = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i)
    const e = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i + 1)
    list.push({ start: s.getTime(), end: e.getTime(), weekend: s.getDay() === 0 || s.getDay() === 6 })
  }
  return { start: list[0]!.start, end: list[list.length - 1]!.end, days: list }
}

/** Where a stay's bar sits, as fractions of the window; null when it misses the window or is not on the board. */
export function barFor(stay: Stay, window: BoardWindow): { left: number; width: number; clippedStart: boolean; clippedEnd: boolean } | null {
  if (!OCCUPIES.includes(stay.status)) return null
  const s = span(stay)
  if (!s || s.end <= window.start || s.start >= window.end) return null
  const len = window.end - window.start
  const from = Math.max(s.start, window.start)
  const to = Math.min(s.end, window.end)
  return {
    left: (from - window.start) / len,
    width: (to - from) / len,
    clippedStart: s.start < window.start,
    clippedEnd: s.end > window.end,
  }
}

/** Where a moment falls on the window, 0 to 1; null outside it. */
export function positionOf(moment: IsoMoment, window: BoardWindow): number | null {
  const t = ms(moment)
  if (t === null || t < window.start || t > window.end) return null
  return (t - window.start) / (window.end - window.start)
}

// How many drivers are home -- approved, there, or were -- on each day of the
// window. The capacity question: how many trucks are parked on Friday.
// A request not yet approved is not counted: it is not a plan yet.
export function homeCounts(stays: readonly Stay[], window: BoardWindow): number[] {
  return window.days.map((day) => {
    const home = new Set<string>()
    for (const s of stays) {
      if (s.status !== 'APPROVED' && s.status !== 'HOME' && s.status !== 'DONE') continue
      const sp = span(s)
      if (sp && sp.start < day.end && sp.end > day.start) home.add(s.driverCode)
    }
    return home.size
  })
}

/** How long a stay is, from what was asked. */
export function stayLength(stay: Stay): number | null {
  const a = ms(stay.homeBy)
  const b = ms(stay.backOut)
  return a === null || b === null ? null : Math.max(0, b - a) / 1000
}

// Minutes since a moment, for "requested 13 h ago".
export function minutesSince(moment: IsoMoment | null, now: IsoMoment): number | null {
  const a = ms(moment)
  const b = ms(now)
  return a === null || b === null ? null : Math.max(0, Math.round((b - a) / 60000))
}

// ---------------------------------------------------------------------------
// GEOTAB MARKS ARRIVING AND LEAVING. Given each truck's recent GPS fixes,
// which approved stays have started and which have ended.
//
// "Home" is within 25 miles of the driver's home town: the planner's own
// definition of HOME, so the two tabs never disagree about where it is. A
// truck has to stay on one side of that line for half an hour before it
// counts -- driving through town on the way to somewhere else is not coming
// home, and a fuel stop just outside it is not leaving.
//
//   arrive  an APPROVED stay whose truck has been home for half an hour, in
//           a run of fixes still going when the stay was approved (a driver
//           who got there before dispatch clicked Approve still arrived).
//           Arrived at the first fix of that run.
//   leave   a HOME stay -- or one that has just arrived above -- whose truck
//           has then been away for half an hour. Left at the first fix
//           outside.
//
// Returns the moves in the order they happened; the caller applies each with
// applyAction(..., { source: 'GEOTAB' }), so a stay that arrived and left
// between two checks goes HOME and then DONE. REQUESTED stays are never
// moved: a truck at home without an approved stay is a conversation for
// dispatch, not something to record on their behalf.
//
// This runs wherever positions and stays both live -- on the host, a job on a
// timer. Being pure, it cannot run twice into a different answer: a move it
// suggested and the caller applied is not suggested again, because the
// stay's status has moved on.
// ---------------------------------------------------------------------------
export const HOME_RADIUS_MILES = 25
export const DWELL_MINUTES = 30

/** One GPS fix: where a driver's truck was, and when. */
export interface Fix {
  driverCode: string
  at: IsoMoment
  latitude: number
  longitude: number
}

/** Where a driver's home is. Unplaced homes are skipped. */
export interface HomePoint {
  driverCode: string
  latitude: number | null
  longitude: number | null
}

export interface HomeMove {
  stayId: string
  driverCode: string
  action: { type: 'arrive'; at: IsoMoment } | { type: 'leave'; at: IsoMoment }
}

// Great-circle miles. A copy of the planner's, for the usual reason.
function milesApart(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.latitude - a.latitude)
  const dLon = rad(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 2 * 3958.8 * Math.asin(Math.sqrt(h))
}

// Consecutive fixes on the same side of the line, as one span of time: from
// its first fix to the first fix of the next run -- or to now, for the last.
interface Run { home: boolean; start: number; end: number }

function runsOf(points: { t: number; home: boolean }[], nowMs: number): Run[] {
  const runs: Run[] = []
  for (const p of points) {
    const last = runs[runs.length - 1]
    if (last && last.home === p.home) continue
    if (last) last.end = p.t
    runs.push({ home: p.home, start: p.t, end: nowMs })
  }
  return runs
}

export function detectHomeMoves(
  stays: readonly Stay[],
  fixes: readonly Fix[],
  homes: readonly HomePoint[],
  { now, radiusMiles = HOME_RADIUS_MILES, dwellMinutes = DWELL_MINUTES }: { now: IsoMoment; radiusMiles?: number; dwellMinutes?: number },
): HomeMove[] {
  const nowMs = ms(now) ?? Date.now()
  const dwell = dwellMinutes * 60000
  const moves: HomeMove[] = []

  for (const stay of stays) {
    if (stay.status !== 'APPROVED' && stay.status !== 'HOME') continue
    const home = homes.find((h) => h.driverCode === stay.driverCode)
    if (!home || home.latitude === null || home.longitude === null) continue
    const centre = { latitude: home.latitude, longitude: home.longitude }

    const points = fixes
      .filter((f) => f.driverCode === stay.driverCode && Number.isFinite(f.latitude) && Number.isFinite(f.longitude))
      .map((f) => ({ t: ms(f.at), home: milesApart(f, centre) <= radiusMiles }))
      .filter((p): p is { t: number; home: boolean } => p.t !== null && p.t <= nowMs)
      .sort((a, b) => a.t - b.t)
    const runs = runsOf(points, nowMs)
    const lasted = (r: Run) => r.end - r.start >= dwell

    let arrived: number | null = stay.status === 'HOME' ? ms(stay.arrivedAt) : null
    if (stay.status === 'APPROVED') {
      const approved = ms(stay.decidedAt) ?? ms(stay.requestedAt) ?? -Infinity
      const run = runs.find((r) => r.home && r.end > approved && lasted(r))
      if (!run) continue
      arrived = run.start
      moves.push({ stayId: stay.id, driverCode: stay.driverCode, action: { type: 'arrive', at: iso(run.start) } })
    }
    if (arrived === null) continue

    const away = runs.find((r) => !r.home && r.start > arrived && lasted(r))
    if (away) moves.push({ stayId: stay.id, driverCode: stay.driverCode, action: { type: 'leave', at: iso(away.start) } })
  }

  return moves.sort((a, b) => Date.parse(a.action.at) - Date.parse(b.action.at))
}
