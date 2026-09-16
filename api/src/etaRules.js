// ---------------------------------------------------------------------------
// When does this truck get there, and is that late.
//
// Pure functions, no network: decide whether an ETA is worth asking for,
// read the answer HERE gives back, and say what it means against the
// delivery window. functions/eta.js does the talking.
//
// TWO THINGS THIS REFUSES TO DO, both for the same reason the map refuses to
// draw a solid line:
//
//   1. It does not ask when the answer would be nonsense. The demo fleet
//      drives around Las Vegas while the freight runs Iowa, so a route from
//      the truck's real position to the real dock is three days long, and
//      correct, and useless. Past about 550 miles from the lane the honest
//      output is nothing at all -- and not asking is also not spending a
//      transaction.
//
//   2. It does not pretend to know the dock. The stops carry a town, and
//      the coordinates come from the Geotab zone of the same name -- a 3 km
//      box around the town, the same places the map plots. So an ETA is to
//      the town, and the last few minutes across it are not in the number.
//
// TIME ZONES, which is the subtle part. Stop windows are stored and shown as
// naive local wall-clock -- 2026-09-10T08:00:00, no zone -- because a dock
// window is local to the dock and always has been. HERE returns each time in
// the local zone OF THAT LOCATION with the offset attached, so the
// comparable value is its wall-clock part with the offset dropped, and the
// two line up correctly even on a lane that crosses a zone. Convert either
// side to UTC "to be safe" and a Denver delivery is an hour wrong.
// ---------------------------------------------------------------------------

// About 550 miles, the same test the load map uses to decide whether to draw
// the truck at all. Degrees rather than miles because it is a cheap box test
// on coordinates, not a distance anybody reads.
const NEAR_LANE_DEG = 8

// A load nobody is driving does not get an ETA. Available means it has not
// been picked up and Delivered means it is over; both would spend a
// transaction answering a question no one asked.
const MOVING = new Set(['Covered', 'In Transit'])

// A position this old is not worth routing from: the truck has been
// somewhere else for hours. Six hours is a driver's shift gone by.
const STALE_MINUTES = 360

function outstanding(stops) {
  return (stops || [])
    .filter((s) => !s.departedUtc)
    .sort((a, b) => a.seq - b.seq)
}

// The empty cases have to be refused BEFORE the conversion, not after it:
// Number(null) is 0 and Number('') is 0, both finite, both in the Atlantic
// off Africa. A truck with no position would otherwise be measured from
// there, and the answer -- "too far away" -- would even look reasonable.
// src/lib/mapProject.js refuses them the same way, for the same reason.
function placeable(p) {
  if (!p) return false
  for (const v of [p.latitude, p.longitude]) {
    if (v === null || v === undefined || v === '') return false
    if (!Number.isFinite(Number(v))) return false
  }
  return true
}

function nearLane(position, points) {
  return points.some((p) => (
    Math.abs(p.latitude - position.latitude) < NEAR_LANE_DEG
    && Math.abs(p.longitude - position.longitude) < NEAR_LANE_DEG
  ))
}

// Everything the route has to decide before spending a transaction.
//
// `zoneFor` is a function from a stop's place name to a coordinate -- the
// same name join the map uses. It is passed in rather than imported so this
// file stays pure and the caller owns the Geotab call.
//
// Returns { ask: false } with a `reason` and a sentence the page can say out
// loud, or { ask: true, points, stops } where points[0] is the truck.
function planEta({ load, stops, position }, zoneFor, now = new Date()) {
  if (!load || !MOVING.has(load.status)) {
    return { ask: false, reason: 'not-moving', message: 'An ETA is only worth having while a load is on the road.' }
  }

  const todo = outstanding(stops)
  if (todo.length === 0) {
    return { ask: false, reason: 'complete', message: 'Every stop on this load has been departed.' }
  }

  if (!placeable(position)) {
    return { ask: false, reason: 'no-position', message: 'GeoTab has no position for this truck, so there is nothing to measure from.' }
  }

  const ageMinutes = position.dateTime
    ? Math.round((now.getTime() - new Date(position.dateTime).getTime()) / 60000)
    : null
  if (ageMinutes !== null && ageMinutes > STALE_MINUTES) {
    return {
      ask: false,
      reason: 'stale-position',
      message: `The last report from this truck is ${Math.round(ageMinutes / 60)} hours old, which is too old to route from.`,
    }
  }

  // Every stop needs a coordinate, and the only source of one is a Geotab
  // zone of the same name. A stop nobody has drawn a box around cannot be
  // routed to, and quietly routing to the ones either side of it would
  // answer a different question with the same confidence.
  const points = []
  const unknown = []
  for (const stop of todo) {
    const zone = zoneFor(stop.place)
    if (zone && placeable(zone)) {
      points.push({ ...stop, latitude: Number(zone.latitude), longitude: Number(zone.longitude) })
    } else {
      unknown.push(stop.place)
    }
  }
  if (unknown.length > 0) {
    return {
      ask: false,
      reason: 'no-places',
      message: `GeoTab has no zone for ${unknown.join(', ')}, so this load cannot be routed.`,
    }
  }

  if (!nearLane(position, points)) {
    return {
      ask: false,
      reason: 'too-far',
      message: 'The truck is too far from this load for an ETA to mean anything.',
    }
  }

  return {
    ask: true,
    stops: points,
    points: [{ latitude: Number(position.latitude), longitude: Number(position.longitude) }, ...points],
  }
}

// HERE's 2026-09-15T19:55:08-05:00 becomes 2026-09-15T19:55:08: the local
// wall clock at that stop, which is the frame the windows are in. See the
// header -- this is deliberate, not a missing conversion.
function wallClock(time) {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/.exec(String(time || ''))
  return m ? m[1] : null
}

// Early, late, or inside the window -- and by how many minutes.
//
// Both sides are naive strings, and JavaScript reads a naive string as local
// time, so the DIFFERENCE between two of them is right whatever zone the
// server happens to be in. That is the only property this needs.
function against(etaLocal, windowStart, windowEnd) {
  if (!etaLocal) return { state: 'unknown', minutes: null }
  const eta = Date.parse(etaLocal)
  const start = windowStart ? Date.parse(windowStart) : NaN
  const end = windowEnd ? Date.parse(windowEnd) : NaN
  if (!Number.isFinite(eta)) return { state: 'unknown', minutes: null }
  if (!Number.isFinite(start) && !Number.isFinite(end)) return { state: 'no-window', minutes: null }

  if (Number.isFinite(end) && eta > end) return { state: 'late', minutes: Math.round((eta - end) / 60000) }
  if (Number.isFinite(start) && eta < start) return { state: 'early', minutes: Math.round((start - eta) / 60000) }
  return { state: 'inWindow', minutes: null }
}

const METRES_PER_MILE = 1609.344

// The answer HERE gave, lined up with the stops it was asked about.
//
// NOT one section per stop, which is what this used to assume. When the
// driver's hours go in with the request the router INSERTS REST STOPS, and
// each one splits the route into another section -- so a three-stop load can
// come back as three sections or as five, depending on how tired the driver
// is. Pairing section i with stop i would then hang an arrival time on the
// wrong dock: a number that reads as perfectly reasonable and is about
// somewhere else entirely.
//
// The rule, from watching real answers (tools/here-hos-probe.mjs):
//
//   * a section that arrives at one of OUR stops carries
//     arrival.place.waypoint -- the index of that via waypoint;
//   * the LAST section always arrives at the destination, which carries no
//     waypoint index because it is not a via;
//   * anything else is a rest the router invented, and it comes with a
//     postAction of `wait` for the rest's duration.
//
// So: walk the sections, accumulate driving and resting, and close off a leg
// each time one of them lands on a stop.
//
// AND MIND WHICH DURATION. summary.duration INCLUDES the post-arrival wait --
// a section with thirty-six minutes of driving and a ten-hour reset reports
// 10h36 -- so driving time comes from travelSummary, which excludes actions.
// Using summary for both would report a driver spending ten hours at the
// wheel.
function readEta(body, stops, { mode = 'truck' } = {}) {
  const route = body && body.routes && body.routes[0]
  const sections = (route && route.sections) || []
  const todo = stops || []

  let totalSeconds = 0
  let totalMetres = 0
  let totalRest = 0
  const legs = []

  // What has accumulated since the last stop: one leg's worth of driving,
  // plus any rest taken on the way to it.
  let driveSeconds = 0
  let metres = 0
  let restSeconds = 0
  let rests = 0

  sections.forEach((section, i) => {
    const summary = section.summary || {}
    const travel = section.travelSummary || {}
    const driving = Number(travel.duration !== undefined ? travel.duration : summary.duration) || 0
    const length = Number(travel.length !== undefined ? travel.length : summary.length) || 0
    driveSeconds += driving
    metres += length

    const waits = (section.postActions || []).filter((a) => a && a.action === 'wait')
    const waited = waits.reduce((total, a) => total + (Number(a.duration) || 0), 0)

    const waypoint = section.arrival && section.arrival.place && section.arrival.place.waypoint
    const endsAtStop = (i === sections.length - 1) || Number.isInteger(waypoint)

    if (!endsAtStop) {
      // A rest. Its wait belongs to the leg still being built, because the
      // driver takes it before reaching the next dock.
      restSeconds += waited
      rests += waits.length
      return
    }

    const stop = todo[legs.length]
    if (!stop) return

    const etaLocal = wallClock(section.arrival && section.arrival.time)
    totalSeconds += driveSeconds
    totalMetres += metres
    totalRest += restSeconds

    legs.push({
      stopId: stop.stopId,
      seq: stop.seq,
      stopType: stop.stopType,
      place: stop.place,
      dock: stop.name || null,
      windowStart: stop.windowStart || null,
      windowEnd: stop.windowEnd || null,
      eta: etaLocal,
      etaWithZone: (section.arrival && section.arrival.time) || null,
      driveSeconds,
      restSeconds,
      rests,
      miles: Math.round(metres / METRES_PER_MILE),
      cumulativeSeconds: totalSeconds + totalRest,
      timing: against(etaLocal, stop.windowStart, stop.windowEnd),
    })

    driveSeconds = 0
    metres = 0
    restSeconds = 0
    rests = 0
  })

  return {
    mode,
    legs,
    partial: legs.length < todo.length,
    totalSeconds,
    totalRestSeconds: totalRest,
    totalMiles: Math.round(totalMetres / METRES_PER_MILE),
    next: legs[0] || null,
    last: legs[legs.length - 1] || null,
  }
}

// The driver's remaining hours, as HERE wants them: pairs of
// driveDuration,restDuration in seconds.
//
// The first pair is what THIS driver has left before they must shut down;
// every pair after it is a fresh day -- eleven hours at the wheel, ten off --
// which is the US property-carrying rule the seeded logs keep.
//
// Which clock binds first decides the first number. A driver can have four
// hours left on the eleven-hour driving clock and forty minutes left of the
// fourteen-hour window, and it is the window that stops them.
//
// HERE refuses a drive duration under 240 seconds, so a driver with nothing
// left is expressed as four minutes and a full reset. That is a lie of four
// minutes, told because the alternative -- a schedule beginning with a rest
// -- cannot be said in this format at all, and because an ETA that ignores
// an empty clock is a lie of ten hours.
const MIN_DRIVE_SECONDS = 240
const DAILY_DRIVE_SECONDS = 11 * 3600
const DAILY_REST_SECONDS = 10 * 3600

function driverSchedule(hos, { days = 3 } = {}) {
  if (!hos || !hos.hasAvailability) return null

  const clocks = [hos.driving, hos.duty, hos.workday]
    .map((v) => (v === null || v === undefined ? null : Number(v)))
    .filter((v) => v !== null && Number.isFinite(v))
  if (clocks.length === 0) return null

  // Rounded DOWN to a quarter of an hour, for two reasons that happen to
  // agree. A driving clock ticks every second, and the schedule is part of
  // the ETA's cache key -- so an exact figure would miss the cache on every
  // single request and spend a metered routing call each time somebody's
  // page refreshed. And rounding down gives the driver LESS time than they
  // have, which moves the arrival later: the direction a dispatcher would
  // rather be wrong in.
  const bucket = 15 * 60
  const tightest = Math.min(...clocks)
  const remaining = Math.max(MIN_DRIVE_SECONDS, Math.floor(tightest / bucket) * bucket)
  const pairs = [Math.round(remaining) + ',' + DAILY_REST_SECONDS]
  for (let i = 1; i < days; i += 1) pairs.push(DAILY_DRIVE_SECONDS + ',' + DAILY_REST_SECONDS)
  return pairs.join(',')
}

module.exports = {
  NEAR_LANE_DEG, MOVING, STALE_MINUTES,
  outstanding, nearLane, planEta, wallClock, against, readEta, driverSchedule,
  MIN_DRIVE_SECONDS, DAILY_DRIVE_SECONDS, DAILY_REST_SECONDS,
}
