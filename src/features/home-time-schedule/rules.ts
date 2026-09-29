import type { IsoMoment, NewStay, Stay, StayAction, StayStatus } from './contract.ts'

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

// ---------------------------------------------------------------------------
// Who may move a stay where. Each action has one destination and a short
// list of places it may start from; anything else is refused with a reason.
// There is no way back: a DONE stay is history, a DECLINED one is answered,
// and a change of plan is a new request -- which keeps the record of what
// was asked and what was said.
// ---------------------------------------------------------------------------
export const MOVES: Readonly<Record<StayAction['type'], { from: readonly StayStatus[]; to: StayStatus; label: string }>> = {
  approve: { from: ['REQUESTED'], to: 'APPROVED', label: 'Approve' },
  decline: { from: ['REQUESTED'], to: 'DECLINED', label: 'Decline' },
  cancel: { from: ['REQUESTED', 'APPROVED'], to: 'CANCELLED', label: 'Cancel' },
  arrive: { from: ['APPROVED'], to: 'HOME', label: 'Arrived home' },
  leave: { from: ['HOME'], to: 'DONE', label: 'Left home' },
}

/** The actions a stay in this status allows, in the order a screen offers them. */
export function actionsFor(status: StayStatus): StayAction['type'][] {
  return (Object.keys(MOVES) as StayAction['type'][]).filter((t) => MOVES[t].from.includes(status))
}

// ---------------------------------------------------------------------------
// Apply one action. Returns the stay as it is after, or a sentence saying why
// not -- never a half-changed stay. `by` is who did it, for decidedBy.
// ---------------------------------------------------------------------------
export function applyAction(stay: Stay, action: StayAction, { now, by }: { now: IsoMoment; by: string | null }):
  { stay: Stay } | { error: string } {
  const move = MOVES[action.type]
  if (!move.from.includes(stay.status)) {
    return { error: `A ${stay.status.toLowerCase()} stay cannot be ${move.to.toLowerCase()}.` }
  }
  const next: Stay = { ...stay, status: move.to }

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
      return { stay: { ...next, arrivedAt: action.at || now } }
    case 'leave': {
      const at = action.at || now
      const arrived = ms(stay.arrivedAt)
      const left = ms(at)
      if (arrived !== null && left !== null && left < arrived) return { error: 'Left home before arriving?' }
      return { stay: { ...next, leftAt: at } }
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
