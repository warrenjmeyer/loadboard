// ---------------------------------------------------------------------------
// Get Me Home: can this driver get home by when they asked, and when does
// dispatch have to start routing them there?
//
// Pure functions. No React, no network, no imports. That is the point of the
// file: it is the part of the planner that has to mean exactly the same thing
// after the port, so it is written to be copied verbatim and to prove itself
// on the other side -- planHome.test.js needs nothing but `node --test`.
//
// UNITS. Durations are SECONDS. Moments are ISO 8601 WITH A ZONE --
// "2026-09-29T17:00:00Z" or "2026-09-29T12:00:00-05:00". A home-by time with
// no zone is refused by checkRoster in contract.js, because "Tuesday 5 PM"
// is a different instant in Dubuque than on a dispatcher's screen in Denver.
// Everything this file hands back is in UTC ("...Z"); the screen decides how
// to show it.
//
// THE HOURS MODEL is the US property-carrying rule, simplified -- and every
// simplification errs toward a LATER arrival, the direction a dispatcher would
// rather be wrong in. A plan that says Tuesday and lands Monday is a pleasant
// surprise; the other way round is a broken promise to somebody's family.
//
//   11 hours driving, inside a 14-hour window, then 10 hours off.
//   A 30-minute break after 8 hours of driving.
//   70 hours in the cycle; when it is spent, a 34-hour restart.
//
// What it leaves out, all of which would make the arrival EARLIER:
//   - the 70-hour cycle recovering as old days roll off (only the restart
//     gives hours back here);
//   - the sleeper-berth split, the 16-hour and adverse-driving exceptions.
// And one thing it leaves out that would make it later: on-duty time that is
// not driving -- fuel, inspections, the gate. That is small on a trip home
// with an empty trailer, and it is named here so nobody thinks it was missed.
// ---------------------------------------------------------------------------

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY_MS = 24 * HOUR * 1000

export const HOS = {
  driveLimit: 11 * HOUR,
  window: 14 * HOUR,
  breakAfter: 8 * HOUR,
  breakLength: 30 * MINUTE,
  dailyRest: 10 * HOUR,
  cycle: 70 * HOUR,
  restart: 34 * HOUR,
}

// When nobody has given us a road route, a straight line stretched by a
// fifth, at 50 mph. Crude on purpose and labelled as such everywhere it
// shows: the host is expected to send a real truck route (routeHome in the
// contract) once it can.
export const ESTIMATE = { roadFactor: 1.2, mph: 50 }

// Inside this, the truck is home already -- a town, not a driveway.
export const AT_HOME_MILES = 25

// Less spare time than this and the driver has to be pointed home NOW: half a
// day is one load that runs late, one closed ramp, one bad night's parking.
export const TIGHT_SECONDS = 12 * HOUR

// A position older than this is where the truck WAS, not where it is. Two
// hours covers a lunch stop with the key off.
export const STALE_MINUTES = 120

export const JOB_TYPES = ['OTR', 'Regional', 'Dedicated', 'Local']

// How long each kind of driver can be out before they are overdue home.
// Nothing federal says this -- home time is company policy, full stop -- so
// these are only the typical figures from the CDL Hometime Guide, and a
// roster can carry its own (roster.policy) to replace any of them.
export const DEFAULT_POLICY = {
  maxDaysOut: { OTR: 21, Regional: 7, Dedicated: 7, Local: 1 },
  defaultMaxDaysOut: 14,
  dueSoonDays: 2,
}

// Most urgent first. "late" and "tight" are the ones that need a dispatcher
// today; "unknown" sits above the routine ones because a driver nobody can
// place is a question somebody should be asking.
export const STATUS_ORDER = ['late', 'tight', 'overdue', 'unknown', 'due-soon', 'on-track', 'ok', 'home']

// ---------------------------------------------------------------------------
// Small readers. A value from the wire is refused BEFORE it is converted:
// Number(null) is 0 and Number('') is 0, both finite, and a clock of zero is
// a driver who cannot move -- a convincing wrong answer.
// ---------------------------------------------------------------------------
function seconds(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function moment(v) {
  if (typeof v !== 'string' || v === '') return null
  const ms = Date.parse(v)
  return Number.isFinite(ms) ? ms : null
}

function iso(ms) {
  return new Date(ms).toISOString()
}

// Same rule for coordinates, plus null island: exactly 0,0 is a device that
// has not found the sky yet, not a truck in the Atlantic.
export function placeable(p) {
  if (!p) return false
  for (const v of [p.latitude, p.longitude]) {
    if (v === null || v === undefined || v === '') return false
    if (!Number.isFinite(Number(v))) return false
  }
  return !(Number(p.latitude) === 0 && Number(p.longitude) === 0)
}

// Great-circle miles, or null when either end cannot be placed.
export function milesBetween(a, b) {
  if (!placeable(a) || !placeable(b)) return null
  const rad = (d) => (Number(d) * Math.PI) / 180
  const dLat = rad(b.latitude) - rad(a.latitude)
  const dLon = rad(b.longitude) - rad(a.longitude)
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 2 * 3958.8 * Math.asin(Math.sqrt(h))
}

export function estimateRoute(from, to) {
  const straight = milesBetween(from, to)
  if (straight === null) return null
  const miles = Math.round(straight * ESTIMATE.roadFactor)
  return { miles, driveSeconds: Math.round((miles / ESTIMATE.mph) * HOUR), source: 'estimate' }
}

// A route the host worked out itself, if it sent a usable one.
function givenRoute(route) {
  if (!route) return null
  const driveSeconds = seconds(route.driveSeconds)
  const miles = seconds(route.miles)
  if (driveSeconds === null || driveSeconds < 0 || miles === null) return null
  return { miles: Math.round(miles), driveSeconds: Math.round(driveSeconds), source: route.source || 'provided' }
}

// Hours are "known" when both clocks that bind on a normal day are there.
// The cycle can be missing on its own; see scheduleDrive.
export function hoursKnown(hours) {
  return Boolean(hours) && seconds(hours.driving) !== null && seconds(hours.duty) !== null
}

function freshDay(cycleLeft) {
  return { drive: HOS.driveLimit, window: HOS.window, cycle: cycleLeft, untilBreak: HOS.breakAfter }
}

// ---------------------------------------------------------------------------
// Lay a drive out against the clocks: drive, break, rest, restart, in order,
// each with its start and end.
//
// `hours` is what the driver has LEFT right now, in seconds -- negative is
// over, and over is treated as zero. With no hours at all the schedule opens
// with a 10-hour rest: not knowing is not the same as having eleven hours,
// and pretending it is would promise a family the wrong evening.
// ---------------------------------------------------------------------------
export function scheduleDrive({ driveSeconds, hours = null, startAt }) {
  const startMs = moment(startAt)
  if (startMs === null) return null

  const blocks = []
  let t = startMs
  const add = (kind, secs, extra) => {
    blocks.push({ kind, start: iso(t), end: iso(t + secs * 1000), seconds: secs, ...extra })
    t += secs * 1000
  }

  let clock
  const known = hoursKnown(hours)
  if (known) {
    const left = (v, full) => {
      const s = seconds(v)
      return s === null ? full : Math.max(0, s)
    }
    // A workday clock, where there is one, binds driving the same way the
    // driving clock does; whichever is smaller is what the driver has.
    const workday = seconds(hours.workday)
    clock = {
      drive: Math.min(left(hours.driving, HOS.driveLimit), workday === null ? Infinity : Math.max(0, workday)),
      window: left(hours.duty, HOS.window),
      cycle: left(hours.cycle, HOS.cycle),
      untilBreak: left(hours.rest, HOS.breakAfter),
    }
  } else {
    add('rest', HOS.dailyRest, { assumed: true })
    clock = freshDay(HOS.cycle)
  }

  let left = Math.max(0, Math.round(seconds(driveSeconds) || 0))
  let driven = 0

  // The guard is for a bug, not for a trip: 200 blocks is weeks of driving.
  for (let guard = 0; left > 0 && guard < 200; guard += 1) {
    if (clock.cycle <= 0) {
      add('restart', HOS.restart)
      clock = freshDay(HOS.cycle)
      continue
    }
    if (clock.drive <= 0 || clock.window <= 0) {
      add('rest', HOS.dailyRest)
      clock = freshDay(clock.cycle)
      continue
    }
    if (clock.untilBreak <= 0) {
      // The break is off duty but the 14-hour window keeps running through
      // it -- which is why a break late in a long day can end the day.
      add('break', HOS.breakLength)
      clock.window -= HOS.breakLength
      clock.untilBreak = HOS.breakAfter
      continue
    }
    const stint = Math.min(left, clock.drive, clock.window, clock.cycle, clock.untilBreak)
    add('drive', stint)
    left -= stint
    driven += stint
    clock.drive -= stint
    clock.window -= stint
    clock.cycle -= stint
    clock.untilBreak -= stint
  }

  const off = blocks.filter((b) => b.kind !== 'drive')
  return {
    blocks,
    arriveAt: iso(t),
    driveSeconds: driven,
    offSeconds: off.reduce((sum, b) => sum + b.seconds, 0),
    rests: off.filter((b) => b.kind === 'rest').length,
    restarts: off.filter((b) => b.kind === 'restart').length,
    assumedRest: !known,
  }
}

// Whole days between two moments, never negative; null when either is
// missing. "Out 6 days" means six full days, the way a driver counts them.
export function daysBetween(fromIso, toIso) {
  const a = moment(fromIso)
  const b = moment(toIso)
  if (a === null || b === null) return null
  return Math.max(0, Math.floor((b - a) / DAY_MS))
}

function minutesSince(fromIso, nowMs) {
  const a = moment(fromIso)
  if (a === null) return null
  return Math.max(0, Math.round((nowMs - a) / 60000))
}

function ago(minutes) {
  if (minutes < 60) return `${minutes} min`
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h`
  return `${Math.round(minutes / 1440)} days`
}

// ---------------------------------------------------------------------------
// Where the trip home begins, and with what clocks.
//
// A driver still on a load goes home from the LAST STOP of that load, once
// it is empty -- nobody deadheads home with a customer's freight in the
// trailer. The clocks they will have left by then are not something this can
// know (the host can send them as currentLoad.hoursAtEmpty), so without them
// the trip home opens with a rest, for the same reason as above.
// ---------------------------------------------------------------------------
function startingPoint(driver, nowMs, warnings) {
  const load = driver.currentLoad
  const loadName = (load && load.id) || 'the current load'

  if (load && load.finalStop) {
    if (placeable(load.finalStop)) {
      const emptyMs = moment(load.emptyAt)
      if (emptyMs === null) {
        warnings.push({
          code: 'no-empty-time',
          level: 'warning',
          text: `${loadName} has no delivery time, so this plans as if the truck were empty now.`,
        })
      }
      const hours = load.hoursAtEmpty || null
      if (!hoursKnown(hours)) {
        warnings.push({
          code: 'hours-after-load-unknown',
          level: 'info',
          text: `The hours left after delivering ${loadName} are not known, so the trip home starts with a 10-hour rest.`,
        })
      }
      return {
        from: 'final-stop',
        loadId: load.id || null,
        place: load.finalStop.place || null,
        latitude: Number(load.finalStop.latitude),
        longitude: Number(load.finalStop.longitude),
        at: iso(emptyMs === null ? nowMs : Math.max(emptyMs, nowMs)),
        hours,
        ageMinutes: null,
      }
    }
    warnings.push({
      code: 'final-stop-unplaced',
      level: 'warning',
      text: `The last stop on ${loadName} has no map position, so this plans from where the truck is now.`,
    })
  }

  const pos = driver.position
  if (!placeable(pos)) return null

  const age = minutesSince(pos.reportedAt, nowMs)
  if (age === null) {
    warnings.push({
      code: 'position-undated',
      level: 'warning',
      text: 'The position has no report time, so the truck may not be there any more.',
    })
  } else if (age > STALE_MINUTES) {
    warnings.push({
      code: 'stale-position',
      level: 'warning',
      text: `Last reported ${ago(age)} ago. The truck has moved since, so the trip home may be shorter or longer than this.`,
    })
  }
  if (!hoursKnown(driver.hours)) {
    warnings.push({
      code: 'no-hours',
      level: 'info',
      text: 'No hours-of-service data for this driver, so the trip home starts with a 10-hour rest. If they have hours left, they get home sooner than this.',
    })
  } else if (seconds(driver.hours.cycle) === null) {
    warnings.push({
      code: 'cycle-unknown',
      level: 'info',
      text: 'No 70-hour cycle figure, so this assumes a full cycle. A 34-hour restart may be needed that is not shown.',
    })
  }
  return {
    from: 'position',
    loadId: null,
    place: pos.near || null,
    latitude: Number(pos.latitude),
    longitude: Number(pos.longitude),
    at: iso(nowMs),
    hours: driver.hours || null,
    ageMinutes: age,
  }
}

function decideStatus({ start, route, schedule, slackSeconds, daysOut, maxDaysOut, dueSoonDays }) {
  if (!schedule) return 'unknown'
  // Only a truck that is empty and sitting in its home town is "home". One
  // delivering there is still working.
  if (start.from === 'position' && route.miles <= AT_HOME_MILES) return 'home'
  if (slackSeconds !== null) {
    if (slackSeconds < 0) return 'late'
    if (slackSeconds < TIGHT_SECONDS) return 'tight'
    return 'on-track'
  }
  if (daysOut !== null && daysOut > maxDaysOut) return 'overdue'
  // "Soon" scales down for short limits, or a local driver home every night
  // would be due soon from the moment they left the yard.
  const soon = Math.min(dueSoonDays, Math.floor(maxDaysOut / 3))
  if (daysOut !== null && daysOut > 0 && daysOut >= maxDaysOut - soon) return 'due-soon'
  return 'ok'
}

export function mergePolicy(policy) {
  return {
    ...DEFAULT_POLICY,
    ...(policy || {}),
    maxDaysOut: { ...DEFAULT_POLICY.maxDaysOut, ...((policy && policy.maxDaysOut) || {}) },
  }
}

// ---------------------------------------------------------------------------
// One driver's plan. Everything the screen shows about a driver comes out of
// here, so a wrong number on screen is a wrong number in this function or in
// the data -- never something a component worked out on its own.
// ---------------------------------------------------------------------------
export function planDriver(driver, { now, policy = DEFAULT_POLICY } = {}) {
  const nowMs = moment(now) ?? Date.now()
  const warnings = []
  const homeTime = driver.homeTime || {}

  const maxDaysOut = policy.maxDaysOut[driver.jobType] ?? policy.defaultMaxDaysOut
  const daysOut = daysBetween(homeTime.lastHomeAt, iso(nowMs))
  if (daysOut === null) {
    warnings.push({
      code: 'no-last-home',
      level: 'info',
      text: 'No record of when this driver was last home, so their days out cannot be counted.',
    })
  }

  const requestedMs = moment(homeTime.requestedBy)
  const start = startingPoint(driver, nowMs, warnings)

  const homePlaced = placeable(driver.home)
  if (!homePlaced) {
    const place = driver.home && driver.home.place
    warnings.push({
      code: 'home-unplaced',
      level: 'warning',
      text: `Home${place ? ` (${place})` : ''} has no map position, so there is no trip home to plan.`,
    })
  }
  if (!start) {
    warnings.push({
      code: 'unplaced',
      level: 'warning',
      text: `Nothing reports where ${driver.unitNo || 'this truck'} is, and it is not on a load, so there is no trip home to plan.`,
    })
  }

  let route = null
  let schedule = null
  if (start && homePlaced) {
    route = givenRoute(driver.routeHome) || estimateRoute(start, driver.home)
    schedule = scheduleDrive({ driveSeconds: route.driveSeconds, hours: start.hours, startAt: start.at })
  }

  const slackSeconds = schedule && requestedMs !== null
    ? Math.round((requestedMs - Date.parse(schedule.arriveAt)) / 1000)
    : null

  // The latest the trip home can begin and still make it. It assumes the
  // clocks as they are now; a driver who waits only gets hours BACK, so the
  // real latest moment is never earlier than this.
  const leaveBy = slackSeconds !== null && slackSeconds >= 0
    ? iso(Date.parse(start.at) + slackSeconds * 1000)
    : null

  return {
    driverCode: driver.driverCode,
    name: driver.name || driver.driverCode,
    jobType: driver.jobType || null,
    unitNo: driver.unitNo || null,
    home: driver.home || null,
    note: homeTime.note || null,
    start,
    route,
    schedule,
    daysOut,
    maxDaysOut,
    requestedBy: requestedMs === null ? null : iso(requestedMs),
    slackSeconds,
    leaveBy,
    status: decideStatus({
      start, route, schedule, slackSeconds, daysOut, maxDaysOut, dueSoonDays: policy.dueSoonDays,
    }),
    warnings,
  }
}

function byUrgency(a, b) {
  const rank = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
  if (rank !== 0) return rank
  // Within a status: least spare time first, then longest out, then by name
  // so the order is the same on every refresh.
  // Compared, not subtracted: Infinity minus a number is Infinity, and a
  // driver with no request would then never sort after one who has.
  const sa = a.slackSeconds ?? Infinity
  const sb = b.slackSeconds ?? Infinity
  if (sa !== sb) return sa < sb ? -1 : 1
  const out = (b.daysOut ?? -1) - (a.daysOut ?? -1)
  if (out !== 0) return out
  return String(a.name).localeCompare(String(b.name))
}

// ---------------------------------------------------------------------------
// The whole roster, planned and sorted most urgent first.
//
// `now` wins if given; otherwise the roster's own asOf (the sample data pins
// one so the preview never drifts); otherwise the clock on the wall.
// ---------------------------------------------------------------------------
export function planRoster(roster, { now } = {}) {
  const asOfMs = moment(now) ?? moment(roster && roster.asOf) ?? Date.now()
  const policy = mergePolicy(roster && roster.policy)
  const plans = ((roster && roster.drivers) || [])
    .map((driver) => planDriver(driver, { now: iso(asOfMs), policy }))
    .sort(byUrgency)
  const counts = {}
  for (const p of plans) counts[p.status] = (counts[p.status] || 0) + 1
  return { asOf: iso(asOfMs), policy, plans, counts }
}
