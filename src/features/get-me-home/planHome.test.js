import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  HOS, AT_HOME_MILES, placeable, milesBetween, estimateRoute, scheduleDrive,
  daysBetween, planDriver, planRoster, mergePolicy, DEFAULT_POLICY,
} from './planHome.js'
import { checkRoster } from './contract.js'

// Read rather than imported: a JSON import needs an attribute under Node and
// none under Vite, and this file has to run under plain `node --test`.
const roster = JSON.parse(readFileSync(new URL('./fixtures/roster.json', import.meta.url), 'utf8'))

const H = 3600
const START = '2026-09-28T15:00:00Z'
const kinds = (s) => s.blocks.map((b) => b.kind)
const hoursBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 1000 / H

const CEDAR_RAPIDS = { place: 'Cedar Rapids, IA', latitude: 41.9779, longitude: -91.6656 }
const CHICAGO = { latitude: 41.8781, longitude: -87.6298 }

test('a coordinate is refused before it is converted, and so is null island', () => {
  assert.equal(placeable({ latitude: 41.9, longitude: -91.6 }), true)
  assert.equal(placeable({ latitude: null, longitude: -91.6 }), false)
  assert.equal(placeable({ latitude: '', longitude: -91.6 }), false)
  assert.equal(placeable({ latitude: 0, longitude: 0 }), false)
  assert.equal(placeable(null), false)
})

test('Cedar Rapids to Chicago is about 210 miles as the crow flies', () => {
  const miles = milesBetween(CEDAR_RAPIDS, CHICAGO)
  assert.ok(miles > 200 && miles < 220, `got ${miles}`)
  assert.equal(milesBetween(CEDAR_RAPIDS, { latitude: null, longitude: 1 }), null)
})

test('an estimate stretches the straight line by a fifth and drives it at 50 mph', () => {
  const r = estimateRoute(CEDAR_RAPIDS, CHICAGO)
  assert.equal(r.source, 'estimate')
  assert.equal(r.miles, Math.round(milesBetween(CEDAR_RAPIDS, CHICAGO) * 1.2))
  assert.equal(r.driveSeconds, Math.round((r.miles / 50) * H))
})

test('a short drive inside every clock is one block', () => {
  const s = scheduleDrive({ driveSeconds: 3 * H, hours: { driving: 8 * H, duty: 10 * H, cycle: 40 * H, rest: 6 * H }, startAt: START })
  assert.deepEqual(kinds(s), ['drive'])
  assert.equal(s.arriveAt, '2026-09-28T18:00:00.000Z')
  assert.equal(s.offSeconds, 0)
})

test('eight hours of driving earns a 30-minute break, and the break is off the clock', () => {
  const s = scheduleDrive({ driveSeconds: 10 * H, hours: { driving: 11 * H, duty: 14 * H, cycle: 70 * H, rest: 8 * H }, startAt: START })
  assert.deepEqual(kinds(s), ['drive', 'break', 'drive'])
  assert.equal(s.blocks[0].seconds, 8 * H)
  assert.equal(s.driveSeconds, 10 * H)
  assert.equal(hoursBetween(START, s.arriveAt), 10.5)
})

test('when the driving clock runs out the driver rests ten hours, then starts a fresh day', () => {
  const s = scheduleDrive({ driveSeconds: 5 * H, hours: { driving: 2 * H, duty: 10 * H, cycle: 70 * H, rest: 8 * H }, startAt: START })
  assert.deepEqual(kinds(s), ['drive', 'rest', 'drive'])
  assert.equal(s.blocks[1].seconds, HOS.dailyRest)
  assert.equal(hoursBetween(START, s.arriveAt), 2 + 10 + 3)
})

test('the 14-hour window can stop a driver who still has driving hours', () => {
  const s = scheduleDrive({ driveSeconds: 5 * H, hours: { driving: 9 * H, duty: 1 * H, cycle: 70 * H, rest: 8 * H }, startAt: START })
  assert.deepEqual(kinds(s), ['drive', 'rest', 'drive'])
  assert.equal(s.blocks[0].seconds, 1 * H)
})

test('a spent cycle means a 34-hour restart before anything moves', () => {
  const s = scheduleDrive({ driveSeconds: 2 * H, hours: { driving: 0, duty: 0, cycle: 0, rest: 0 }, startAt: START })
  assert.deepEqual(kinds(s), ['restart', 'drive'])
  assert.equal(s.restarts, 1)
  assert.equal(hoursBetween(START, s.arriveAt), 36)
})

test('a clock that is over counts as zero, not as a negative that adds time', () => {
  const s = scheduleDrive({ driveSeconds: 1 * H, hours: { driving: -1800, duty: 5 * H, cycle: 50 * H }, startAt: START })
  assert.deepEqual(kinds(s), ['rest', 'drive'])
})

test('unknown hours open with an assumed rest -- not knowing is not having eleven hours', () => {
  const s = scheduleDrive({ driveSeconds: 2 * H, hours: null, startAt: START })
  assert.deepEqual(kinds(s), ['rest', 'drive'])
  assert.equal(s.blocks[0].assumed, true)
  assert.equal(s.assumedRest, true)
})

test('days out are whole days and never negative', () => {
  assert.equal(daysBetween('2026-09-22T12:00:00Z', '2026-09-28T15:00:00Z'), 6)
  assert.equal(daysBetween('2026-09-29T12:00:00Z', '2026-09-28T15:00:00Z'), 0)
  assert.equal(daysBetween(null, '2026-09-28T15:00:00Z'), null)
})

// A driver built from parts, so each test says only what it is about.
function driver(overrides = {}) {
  return {
    driverCode: 'TEST', name: 'Test Driver', jobType: 'Regional', unitNo: 'Demo - 99',
    home: CEDAR_RAPIDS,
    position: { near: 'Chicago, IL', ...CHICAGO, reportedAt: '2026-09-28T14:55:00Z' },
    hours: { driving: 11 * H, duty: 14 * H, cycle: 60 * H, rest: 8 * H },
    currentLoad: null,
    homeTime: { lastHomeAt: '2026-09-25T12:00:00Z', requestedBy: null },
    ...overrides,
  }
}

test('home by a time it cannot make is late; with under 12 hours spare it is tight; otherwise on track', () => {
  const at = (requestedBy) => planDriver(driver({ homeTime: { lastHomeAt: null, requestedBy } }), { now: START }).status
  // Chicago to Cedar Rapids is about five hours at the estimate's speed.
  assert.equal(at('2026-09-28T17:00:00Z'), 'late')
  assert.equal(at('2026-09-28T23:00:00Z'), 'tight')
  assert.equal(at('2026-09-30T12:00:00Z'), 'on-track')
})

test('the latest start is now plus the spare time', () => {
  const p = planDriver(driver({ homeTime: { lastHomeAt: null, requestedBy: '2026-09-29T12:00:00-05:00' } }), { now: START })
  assert.equal(Date.parse(p.leaveBy) - Date.parse(START), p.slackSeconds * 1000)
})

test('with no request, days out against the policy decide overdue, due soon, or ok', () => {
  const out = (lastHomeAt, jobType = 'Regional') => planDriver(driver({ jobType, homeTime: { lastHomeAt, requestedBy: null } }), { now: START }).status
  assert.equal(out('2026-09-20T12:00:00Z'), 'overdue') // 8 of 7
  assert.equal(out('2026-09-23T12:00:00Z'), 'due-soon') // 5 of 7
  assert.equal(out('2026-09-26T12:00:00Z'), 'ok') // 2 of 7
  // A local driver is not "due soon" the morning they leave the yard.
  assert.equal(out('2026-09-28T06:00:00Z', 'Local'), 'ok')
  assert.equal(out('2026-09-27T06:00:00Z', 'Local'), 'due-soon')
})

test('an empty truck in its home town is home; one delivering there is not', () => {
  const inTown = { near: 'Cedar Rapids, IA', latitude: 41.99, longitude: -91.64, reportedAt: START }
  assert.equal(planDriver(driver({ position: inTown }), { now: START }).status, 'home')

  const delivering = planDriver(driver({
    currentLoad: { id: 'L-1', finalStop: { place: 'Marion, IA', latitude: 42.03, longitude: -91.6 }, emptyAt: '2026-09-28T20:00:00Z' },
  }), { now: START })
  assert.ok(delivering.route.miles <= AT_HOME_MILES)
  assert.notEqual(delivering.status, 'home')
})

test('a driver on a load goes home from the last stop, once it is empty, after a rest', () => {
  const p = planDriver(driver({
    currentLoad: { id: 'L-30412', finalStop: { place: 'Joliet, IL', latitude: 41.525, longitude: -88.0817 }, emptyAt: '2026-09-28T16:00:00-05:00' },
  }), { now: START })
  assert.equal(p.start.from, 'final-stop')
  assert.equal(p.start.at, '2026-09-28T21:00:00.000Z')
  assert.equal(p.schedule.blocks[0].kind, 'rest')
  assert.ok(p.warnings.some((w) => w.code === 'hours-after-load-unknown'))
})

test('a route the host sends beats the estimate', () => {
  const p = planDriver(driver({ routeHome: { miles: 244, driveSeconds: 15900, source: 'here-truck' } }), { now: START })
  assert.deepEqual(p.route, { miles: 244, driveSeconds: 15900, source: 'here-truck' })
})

test('a truck nobody can place has no plan, and says why', () => {
  const p = planDriver(driver({ position: null }), { now: START })
  assert.equal(p.status, 'unknown')
  assert.equal(p.schedule, null)
  assert.ok(p.warnings.some((w) => w.code === 'unplaced'))
})

test('an old position is used, and flagged', () => {
  const p = planDriver(driver({ position: { ...CHICAGO, near: 'Chicago, IL', reportedAt: '2026-09-28T10:00:00Z' } }), { now: START })
  assert.ok(p.schedule)
  assert.ok(p.warnings.some((w) => w.code === 'stale-position'))
})

test('a company policy replaces only the limits it names', () => {
  const policy = mergePolicy({ maxDaysOut: { OTR: 14 } })
  assert.equal(policy.maxDaysOut.OTR, 14)
  assert.equal(policy.maxDaysOut.Regional, DEFAULT_POLICY.maxDaysOut.Regional)
})

test('the sample roster matches the contract', () => {
  assert.deepEqual(checkRoster(roster), [])
})

test('the contract catches the mistakes a port makes', () => {
  const bad = structuredClone(roster)
  bad.drivers[0].homeTime.requestedBy = '2026-09-29T18:00:00' // no zone
  bad.drivers[1].hours.driving = 11 // hours, not seconds
  bad.drivers[2].home.latitude = '41.26' // a string
  delete bad.drivers[3].name
  const problems = checkRoster(bad)
  assert.equal(problems.length, 4, problems.join('\n'))
  assert.match(problems.join('\n'), /no time zone/)
  assert.match(problems.join('\n'), /looks like hours/)
})

test('the sample roster covers every status, most urgent first', () => {
  const { plans, counts } = planRoster(roster)
  assert.deepEqual(plans.map((p) => p.status), [
    'late', 'tight', 'tight', 'overdue', 'unknown', 'due-soon', 'on-track', 'ok', 'home',
  ])
  assert.equal(counts.tight, 2)
  // Of the two tight drivers, the one with less time to spare comes first.
  assert.ok(plans[1].slackSeconds <= plans[2].slackSeconds)
  // Dale Foster is tight because of the restart, not the miles.
  const foster = plans.find((p) => p.driverCode === 'DFOSTER')
  assert.equal(foster.status, 'tight')
  assert.equal(foster.schedule.restarts, 1)
})
