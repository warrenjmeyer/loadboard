const test = require('node:test')
const assert = require('node:assert/strict')
const rules = require('./etaRules')

// ---------------------------------------------------------------------------
// node --test
//
// An ETA is a number a dispatcher will ring a customer about, so the ways it
// can be quietly wrong are the point of this file: an arrival paired with
// the wrong dock, a time zone converted once too often, or a route asked for
// -- and paid for -- when the answer was never going to mean anything.
//
// The fixture is a REAL HERE answer, trimmed: Waterloo -> Dubuque ->
// Minneapolis, asked as a truck on 2026-09-15. The numbers in it are the
// ones HERE actually returned, which is why the totals below are odd rather
// than round.
// ---------------------------------------------------------------------------

const HERE_ANSWER = {
  routes: [{
    id: 'a-real-answer',
    sections: [
      {
        id: 'section-1',
        type: 'vehicle',
        departure: { time: '2026-09-15T13:16:32-05:00', place: { type: 'place', location: { lat: 42.4928, lng: -92.3426 } } },
        // waypoint: 0 -- the index of the via this section arrives at. The
        // real answer carries it (see here-probe-truck.json) and this fixture
        // was written without it, before anyone knew it mattered. It matters:
        // it is how a stop is told apart from a rest the router invented.
        arrival: { time: '2026-09-15T14:55:02-05:00', place: { type: 'place', waypoint: 0, location: { lat: 42.5006, lng: -90.6646 } } },
        summary: { duration: 5910, length: 148228, baseDuration: 5832 },
        transport: { mode: 'truck' },
      },
      {
        id: 'section-2',
        type: 'vehicle',
        departure: { time: '2026-09-15T14:55:02-05:00', place: { type: 'place', location: { lat: 42.5006, lng: -90.6646 } } },
        arrival: { time: '2026-09-15T19:55:08-05:00', place: { type: 'place', location: { lat: 44.9778, lng: -93.265 } } },
        summary: { duration: 18006, length: 502237, baseDuration: 17733 },
        transport: { mode: 'truck' },
      },
    ],
  }],
}

const DUBUQUE = {
  stopId: 2, seq: 2, stopType: 'Delivery', place: 'DUBUQUE, IA', name: 'Mississippi Valley Foods',
  windowStart: '2026-09-15T13:00:00', windowEnd: '2026-09-15T15:00:00', arrivedUtc: null, departedUtc: null,
}
const MINNEAPOLIS = {
  stopId: 3, seq: 3, stopType: 'Delivery', place: 'MINNEAPOLIS, MN', name: 'North Loop Cold Storage',
  windowStart: '2026-09-15T18:00:00', windowEnd: '2026-09-15T19:00:00', arrivedUtc: null, departedUtc: null,
}
const WATERLOO = {
  stopId: 1, seq: 1, stopType: 'Pickup', place: 'WATERLOO, IA', name: 'Cedar Valley Cold',
  windowStart: '2026-09-15T08:00:00', windowEnd: '2026-09-15T12:00:00',
  arrivedUtc: '2026-09-15T12:40:00', departedUtc: '2026-09-15T13:10:00',
}

const ZONES = new Map([
  ['WATERLOO, IA', { latitude: 42.4928, longitude: -92.3426 }],
  ['DUBUQUE, IA', { latitude: 42.5006, longitude: -90.6646 }],
  ['MINNEAPOLIS, MN', { latitude: 44.9778, longitude: -93.265 }],
])
const zoneFor = (place) => ZONES.get(String(place || '').trim().toUpperCase()) || null

const NOW = new Date('2026-09-15T18:20:00.000Z')
const IN_TRANSIT = { id: 'L-10416', status: 'In Transit', unitNo: 'Demo - 15', driverCode: 'JSMITH' }
const NEAR_WATERLOO = { latitude: 42.5, longitude: -92.3, dateTime: '2026-09-15T18:10:00.000Z' }
const IN_VEGAS = { latitude: 36.0668, longitude: -115.0396, dateTime: '2026-09-15T18:10:00.000Z' }

// ---------------------------------------------------------------------------
// Whether to ask at all. Every "no" here is a transaction not spent.
// ---------------------------------------------------------------------------

test('only a load on the road gets an ETA', () => {
  for (const status of ['Available', 'Delivered', 'Cancelled']) {
    const plan = rules.planEta({ load: { ...IN_TRANSIT, status }, stops: [DUBUQUE], position: NEAR_WATERLOO }, zoneFor, NOW)
    assert.equal(plan.ask, false)
    assert.equal(plan.reason, 'not-moving')
  }
  for (const status of ['Covered', 'In Transit']) {
    const plan = rules.planEta({ load: { ...IN_TRANSIT, status }, stops: [DUBUQUE], position: NEAR_WATERLOO }, zoneFor, NOW)
    assert.equal(plan.ask, true)
  }
})

test('a departed stop is behind the truck and not routed to', () => {
  const plan = rules.planEta({ load: IN_TRANSIT, stops: [WATERLOO, DUBUQUE, MINNEAPOLIS], position: NEAR_WATERLOO }, zoneFor, NOW)
  assert.equal(plan.ask, true)
  assert.deepEqual(plan.stops.map((s) => s.stopId), [2, 3])
  // The truck is where the route starts, then the stops in order. Getting
  // this list out of order would produce a plausible ETA for a journey
  // nobody is making.
  assert.equal(plan.points.length, 3)
  assert.deepEqual(plan.points[0], { latitude: 42.5, longitude: -92.3 })
  assert.equal(plan.points[1].latitude, 42.5006)
  assert.equal(plan.points[2].latitude, 44.9778)
})

test('a load with every stop departed is over, not late', () => {
  const done = [{ ...DUBUQUE, departedUtc: '2026-09-15T15:00:00' }]
  const plan = rules.planEta({ load: IN_TRANSIT, stops: done, position: NEAR_WATERLOO }, zoneFor, NOW)
  assert.equal(plan.reason, 'complete')
})

test('no position, or one from this morning, is nothing to measure from', () => {
  assert.equal(rules.planEta({ load: IN_TRANSIT, stops: [DUBUQUE], position: null }, zoneFor, NOW).reason, 'no-position')
  const blank = { latitude: null, longitude: null, dateTime: null }
  assert.equal(rules.planEta({ load: IN_TRANSIT, stops: [DUBUQUE], position: blank }, zoneFor, NOW).reason, 'no-position')
  const old = { ...NEAR_WATERLOO, dateTime: '2026-09-15T04:00:00.000Z' }
  const stale = rules.planEta({ load: IN_TRANSIT, stops: [DUBUQUE], position: old }, zoneFor, NOW)
  assert.equal(stale.reason, 'stale-position')
  assert.match(stale.message, /14 hours old/)
})

test('the demo fleet in Las Vegas does not get an Iowa ETA', () => {
  // The reason this rule exists: the route would come back correct, three
  // days long, and useless -- and it would cost a transaction to get.
  const plan = rules.planEta({ load: IN_TRANSIT, stops: [DUBUQUE, MINNEAPOLIS], position: IN_VEGAS }, zoneFor, NOW)
  assert.equal(plan.ask, false)
  assert.equal(plan.reason, 'too-far')
})

test('a stop GeoTab has no zone for stops the whole route', () => {
  // Not "route to the others": skipping a stop silently answers a different
  // question. The page says which place it does not know.
  const odd = { ...DUBUQUE, place: 'Nowhere, ZZ' }
  const plan = rules.planEta({ load: IN_TRANSIT, stops: [odd, MINNEAPOLIS], position: NEAR_WATERLOO }, zoneFor, NOW)
  assert.equal(plan.ask, false)
  assert.equal(plan.reason, 'no-places')
  assert.match(plan.message, /Nowhere, ZZ/)
})

// ---------------------------------------------------------------------------
// Reading the answer.
// ---------------------------------------------------------------------------

test('each section arrives at its own stop, in order', () => {
  const answer = rules.readEta(HERE_ANSWER, [DUBUQUE, MINNEAPOLIS], { mode: 'truck' })
  assert.equal(answer.legs.length, 2)
  assert.deepEqual(answer.legs.map((l) => l.stopId), [2, 3])
  assert.equal(answer.legs[0].eta, '2026-09-15T14:55:02')
  assert.equal(answer.legs[1].eta, '2026-09-15T19:55:08')
  assert.equal(answer.legs[0].miles, 92)
  assert.equal(answer.legs[1].miles, 312)
  assert.equal(answer.totalMiles, 404)
  assert.equal(answer.totalSeconds, 23916)
  assert.equal(answer.partial, false)
  assert.equal(answer.next.stopId, 2)
  assert.equal(answer.last.stopId, 3)
  // Cumulative, so a page can say "four hours from now" without adding up.
  assert.equal(answer.legs[1].cumulativeSeconds, 23916)
})

test('fewer sections than stops keeps the pairs it has and says so', () => {
  const short = { routes: [{ sections: [HERE_ANSWER.routes[0].sections[0]] }] }
  const answer = rules.readEta(short, [DUBUQUE, MINNEAPOLIS])
  assert.equal(answer.legs.length, 1)
  assert.equal(answer.legs[0].stopId, 2, 'the one leg belongs to the first stop, not the last')
  assert.equal(answer.partial, true)
})

test('an answer with no route in it is empty, not a crash', () => {
  for (const body of [null, {}, { routes: [] }, { routes: [{ sections: [] }] }]) {
    const answer = rules.readEta(body, [DUBUQUE])
    assert.equal(answer.legs.length, 0)
    assert.equal(answer.next, null)
    assert.equal(answer.totalMiles, 0)
  }
})

// ---------------------------------------------------------------------------
// Early, late, and the time zone trap.
// ---------------------------------------------------------------------------

test('late by the end of the window, early by the start of it', () => {
  const answer = rules.readEta(HERE_ANSWER, [DUBUQUE, MINNEAPOLIS])
  // 14:55 into a 13:00-15:00 window: inside it, with five minutes to spare.
  assert.equal(answer.legs[0].timing.state, 'inWindow')
  // 19:55 against a window that shut at 19:00.
  assert.deepEqual(answer.legs[1].timing, { state: 'late', minutes: 55 })
})

test('a window with only one end still decides', () => {
  assert.deepEqual(rules.against('2026-09-15T20:00:00', null, '2026-09-15T19:00:00'), { state: 'late', minutes: 60 })
  assert.deepEqual(rules.against('2026-09-15T07:00:00', '2026-09-15T08:00:00', null), { state: 'early', minutes: 60 })
  assert.equal(rules.against('2026-09-15T20:00:00', null, null).state, 'no-window')
  assert.equal(rules.against(null, '2026-09-15T08:00:00', null).state, 'unknown')
})

test('HERE times are local to the stop, and stay that way', () => {
  // The trap this guards. HERE returns each time in the zone of the place it
  // describes; the dock's window is naive local time. Comparing the wall
  // clocks is correct. "Helpfully" normalising either side to UTC would make
  // this Denver delivery an hour late instead of five minutes early -- and
  // it would look right, because the number would still be plausible.
  const denver = {
    routes: [{ sections: [{
      departure: { time: '2026-09-15T13:00:00-05:00' },
      arrival: { time: '2026-09-15T17:55:00-06:00' },
      summary: { duration: 21300, length: 500000 },
    }] }],
  }
  const stop = { stopId: 9, seq: 2, stopType: 'Delivery', place: 'DENVER, CO', windowStart: '2026-09-15T18:00:00', windowEnd: '2026-09-15T20:00:00' }
  const answer = rules.readEta(denver, [stop])
  assert.equal(answer.legs[0].eta, '2026-09-15T17:55:00')
  assert.deepEqual(answer.legs[0].timing, { state: 'early', minutes: 5 })
  // The offset is not thrown away, just not used for the comparison.
  assert.equal(answer.legs[0].etaWithZone, '2026-09-15T17:55:00-06:00')
})

test('the wall clock is taken from the front of the string, not computed', () => {
  assert.equal(rules.wallClock('2026-09-15T19:55:08-05:00'), '2026-09-15T19:55:08')
  assert.equal(rules.wallClock('2026-09-15T19:55:08+02:00'), '2026-09-15T19:55:08')
  assert.equal(rules.wallClock('2026-09-15T19:55:08Z'), '2026-09-15T19:55:08')
  assert.equal(rules.wallClock('2026-09-15T19:55:08'), '2026-09-15T19:55:08')
  assert.equal(rules.wallClock(null), null)
  assert.equal(rules.wallClock('tomorrow'), null)
})

// ---------------------------------------------------------------------------
// The driver's hours, in the route.
//
// The fixture is a real HERE answer, trimmed: Las Vegas -> St. George -> Salt
// Lake City asked with driver[schedule]=2400,36000,... -- a driver with forty
// minutes left. The router inserted a ten-hour reset, which turned a six and
// a half hour run into a sixteen hour one and split the route into THREE
// sections for TWO stops. That split is the thing these tests exist for.
// ---------------------------------------------------------------------------

const WITH_REST = {
  routes: [{
    sections: [
      {
        // 36 minutes of driving, then a 10 hour reset. Note the summary says
        // 10h36 and travelSummary says 36m: that difference is the trap.
        summary: { duration: 38160, length: 58000 },
        travelSummary: { duration: 2160, length: 58000 },
        departure: { time: '2026-09-16T06:57:16-07:00', place: { type: 'place' } },
        arrival: { time: '2026-09-16T07:33:16-07:00', place: { type: 'place' } },
        postActions: [{ action: 'wait', duration: 36000 }],
      },
      {
        summary: { duration: 4800, length: 150000 },
        travelSummary: { duration: 4800, length: 150000 },
        departure: { time: '2026-09-16T17:33:16-07:00', place: { type: 'place' } },
        arrival: { time: '2026-09-16T19:53:31-06:00', place: { type: 'place', waypoint: 0 } },
      },
      {
        summary: { duration: 16020, length: 480000 },
        travelSummary: { duration: 16020, length: 480000 },
        departure: { time: '2026-09-16T19:53:31-06:00', place: { type: 'place', waypoint: 0 } },
        arrival: { time: '2026-09-17T00:20:11-06:00', place: { type: 'place' } },
      },
    ],
  }],
}

const ST_GEORGE = {
  stopId: 21, seq: 2, stopType: 'Delivery', place: 'ST. GEORGE, UT',
  windowStart: '2026-09-16T18:00:00', windowEnd: '2026-09-16T22:00:00',
}
const SALT_LAKE = {
  stopId: 22, seq: 3, stopType: 'Delivery', place: 'SALT LAKE CITY, UT',
  windowStart: '2026-09-16T20:00:00', windowEnd: '2026-09-17T02:00:00',
}

test('a rest is not a stop, and does not consume one', () => {
  // THE BUG THIS PREVENTS: three sections, two stops. Pairing them in order
  // would tell a dispatcher the truck reaches St. George at 07:33 -- the time
  // it pulled over to sleep, at a truck stop, a hundred miles short.
  const answer = rules.readEta(WITH_REST, [ST_GEORGE, SALT_LAKE])
  assert.equal(answer.legs.length, 2)
  assert.deepEqual(answer.legs.map((l) => l.stopId), [21, 22])
  assert.equal(answer.legs[0].eta, '2026-09-16T19:53:31')
  assert.equal(answer.legs[1].eta, '2026-09-17T00:20:11')
  assert.equal(answer.partial, false)
})

test('the rest belongs to the leg it happens on', () => {
  const answer = rules.readEta(WITH_REST, [ST_GEORGE, SALT_LAKE])
  assert.equal(answer.legs[0].restSeconds, 36000, 'ten hours, before St. George')
  assert.equal(answer.legs[0].rests, 1)
  assert.equal(answer.legs[1].restSeconds, 0, 'and none after it')
  assert.equal(answer.totalRestSeconds, 36000)
})

test('driving time is driving, not driving plus sleeping', () => {
  // summary.duration on that first section is 10h36. A driver did not drive
  // for ten and a half hours; they drove for thirty-six minutes and slept.
  const answer = rules.readEta(WITH_REST, [ST_GEORGE, SALT_LAKE])
  assert.equal(answer.legs[0].driveSeconds, 2160 + 4800, 'both driving stretches, no wait')
  assert.equal(answer.totalSeconds, 2160 + 4800 + 16020)
  assert.ok(answer.totalSeconds < 7 * 3600, 'six and a half hours at the wheel')
  // But the clock on the wall moved sixteen hours, and that is what an
  // arrival time has to be built from.
  const elapsed = (Date.parse(answer.legs[1].etaWithZone) - Date.parse('2026-09-16T06:57:16-07:00')) / 3600000
  assert.ok(elapsed > 16 && elapsed < 17, `door to door was ${elapsed} hours`)
})

test('without a schedule the sections and the stops line up as before', () => {
  const noRest = { routes: [{ sections: [WITH_REST.routes[0].sections[1], WITH_REST.routes[0].sections[2]] }] }
  const answer = rules.readEta(noRest, [ST_GEORGE, SALT_LAKE])
  assert.equal(answer.legs.length, 2)
  assert.equal(answer.legs[0].restSeconds, 0)
  assert.equal(answer.totalRestSeconds, 0)
})

// ---------------------------------------------------------------------------
// Turning GeoTab's clocks into HERE's schedule.
// ---------------------------------------------------------------------------

test('the tightest clock decides how long they may drive', () => {
  // Four hours of driving left but forty minutes of the fourteen-hour
  // window: it is the window that stops them, and a schedule built from the
  // driving clock alone would promise four hours that cannot legally happen.
  const hos = { hasAvailability: true, driving: 4 * 3600, duty: 40 * 60, workday: 40 * 60 }
  // 40 minutes, rounded down to the quarter hour: 30. See the note on the
  // function -- it keeps the answer cacheable and errs towards a later
  // arrival rather than an earlier one.
  assert.equal(rules.driverSchedule(hos, { days: 2 }), '1800,36000,39600,36000')
})

test('the clock is bucketed so the same question is not paid for twice', () => {
  // A driving clock ticks every second and the schedule is part of the ETA's
  // cache key. Without this, every page refresh would be a fresh billed
  // routing call for an answer that had not meaningfully changed.
  const at = (seconds) => rules.driverSchedule(
    { hasAvailability: true, driving: seconds, duty: seconds, workday: seconds },
    { days: 1 },
  )
  // Two clocks inside the same quarter hour are the same question, so the
  // second one is answered from the cache rather than from HERE.
  assert.equal(at(3700), at(3660), 'a minute apart, inside one bucket')
  assert.equal(at(3700), '3600,36000')
  // Crossing a boundary is a different question, and should be: the driver
  // really has a quarter hour less than they did.
  assert.notEqual(at(3600), at(2600))
  // And it never rounds UP into time the driver does not have. A second
  // short of the hour is three quarters of an hour, not an hour.
  assert.equal(at(3599), '2700,36000')
})

test('a driver with nothing left gets the smallest drive HERE will accept', () => {
  // HERE refuses under 240 seconds. Four minutes then a full reset is a lie
  // of four minutes; ignoring the empty clock would be a lie of ten hours.
  const hos = { hasAvailability: true, driving: 0, duty: 0, workday: 0 }
  assert.equal(rules.driverSchedule(hos, { days: 1 }), '240,36000')
  const over = { hasAvailability: true, driving: -1800, duty: -1800, workday: null }
  assert.equal(rules.driverSchedule(over, { days: 1 }), '240,36000')
})

test('no clocks means no schedule, not a guessed one', () => {
  // A driver GeoTab has no availability record for gets an ETA with no hours
  // in it at all, which is what the app did yesterday -- rather than an ETA
  // built on invented hours, which would be worse than none.
  assert.equal(rules.driverSchedule(null), null)
  assert.equal(rules.driverSchedule({ hasAvailability: false, driving: 3600 }), null)
  assert.equal(rules.driverSchedule({ hasAvailability: true, driving: null, duty: null, workday: null }), null)
})

test('a fresh driver gets eleven and ten, repeating', () => {
  const hos = { hasAvailability: true, driving: 11 * 3600, duty: 14 * 3600, workday: 14 * 3600 }
  assert.equal(rules.driverSchedule(hos, { days: 3 }), '39600,36000,39600,36000,39600,36000')
})
