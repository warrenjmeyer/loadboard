import test from 'node:test'
import assert from 'node:assert/strict'
import { stateOf, zonedFromWallClock } from './dockTime.ts'
import { buildLoadboardRoster, jobTypeOf } from './loadboardRoster.ts'
import type { ApiHours, ApiPositions, ApiRosterDriver, ApiZones } from './loadboardRoster.ts'
import { checkRoster } from '../contract.ts'
import { planRoster } from '../planHome.ts'

// ---------------------------------------------------------------------------
// The payloads are written out in the shapes the load board's API returns --
// GET /api/roster, /api/telematics/positions, /hours and /zones -- trimmed to
// the fields the adapter reads. The mapping is the thing under test, so the
// data is small enough to check by eye.
// ---------------------------------------------------------------------------
const H = 3600

const zones: ApiZones = {
  zones: [
    { name: 'CEDAR RAPIDS, IA', key: 'CEDAR RAPIDS, IA', latitude: 41.9779, longitude: -91.6656 },
    { name: 'JOLIET, IL', key: 'JOLIET, IL', latitude: 41.525, longitude: -88.0817 },
    { name: 'DAVENPORT, IA', key: 'DAVENPORT, IA', latitude: 41.5236, longitude: -90.5776 },
  ],
}

const roster: ApiRosterDriver[] = [
  // Driving, reporting, clocks known, lives in a town with a zone.
  { driverCode: 'HBARNETT', name: 'Hollis Barnett', unitNo: 'Demo - 01', job: 'OTR Driver',
    home: { city: 'Cedar Rapids', state: 'IA' }, currentLoad: null },
  // On a load to Joliet; lives in Davenport. Sitting in somebody else's truck.
  { driverCode: 'RDELGADO', name: 'Rosa Delgado', unitNo: 'Demo - 04', job: 'Company Driver',
    home: { city: 'Davenport', state: 'IA' },
    currentLoad: { id: 'L-30412', status: 'In Transit', destination: 'JOLIET, IL', deliveryEnd: '2026-09-28T16:00:00' } },
  // An owner-operator whose truck has never reported, from a town with no zone.
  { driverCode: 'RVASQUEZ', name: 'Rey Vasquez', unitNo: 'Demo - 21', job: 'Owner Operator',
    home: { city: 'Marshalltown', state: 'IA' }, currentLoad: null },
]

const positions: ApiPositions = {
  asOf: '2026-09-28T15:00:00.000Z',
  trucks: [
    { unitNo: 'Demo - 01', reported: true, dateTime: '2026-09-28T14:51:00.000Z', latitude: 39.0997, longitude: -94.5786,
      near: 'Kansas City, MO', driver: { driverCode: 'HBARNETT', name: 'Hollis Barnett' } },
    { unitNo: 'Demo - 04', reported: true, dateTime: '2026-09-28T14:40:00.000Z', latitude: 40, longitude: -95,
      near: 'Nowhere, NE', driver: null },
    { unitNo: 'Demo - 09', reported: true, dateTime: '2026-09-28T14:55:00.000Z', latitude: 41.3275, longitude: -89.129,
      near: 'Peru, IL', driver: { driverCode: 'RDELGADO', name: 'Rosa Delgado' } },
    { unitNo: 'Demo - 21', reported: false, dateTime: null, latitude: null, longitude: null, driver: null },
  ],
}

const hours: ApiHours = {
  asOf: '2026-09-28T15:00:00.000Z',
  drivers: [
    { driverCode: 'HBARNETT', hasAvailability: true, driving: 1.5 * H, duty: 2 * H, workday: null, cycle: 41 * H, rest: 1 * H, statusLabel: 'Driving' },
    { driverCode: 'RDELGADO', hasAvailability: true, driving: 4 * H, duty: 5 * H, workday: null, cycle: 50 * H, rest: 4 * H, statusLabel: 'Driving' },
    // Matched in GeoTab, but no hours-of-service logs: that is not zero hours.
    { driverCode: 'RVASQUEZ', hasAvailability: false, driving: null, duty: null, workday: null, cycle: null, rest: null, statusLabel: null },
  ],
}

const built = buildLoadboardRoster({ roster, positions, hours, zones })
const byCode = (code: string) => {
  const d = built.drivers.find((x) => x.driverCode === code)
  if (!d) throw new Error(`no driver ${code}`)
  return d
}

test('a dock time takes its state\'s zone, daylight saving and all', () => {
  assert.equal(zonedFromWallClock('2026-09-28T16:00:00', 'America/Chicago'), '2026-09-28T16:00:00-05:00')
  assert.equal(zonedFromWallClock('2026-01-15T08:30:00', 'America/Chicago'), '2026-01-15T08:30:00-06:00')
  // Arizona does not change its clocks, so July is still seven hours behind.
  assert.equal(zonedFromWallClock('2026-07-01T09:00:00', 'America/Phoenix'), '2026-07-01T09:00:00-07:00')
  // The morning the clocks go back: 01:30 happens twice, and either answer is
  // a real moment; what matters is that the wall clock is kept as written.
  assert.match(zonedFromWallClock('2026-11-01T01:30:00', 'America/Chicago') || '', /^2026-11-01T01:30:00-0[56]:00$/)
  assert.equal(zonedFromWallClock('not a time', 'America/Chicago'), null)
  assert.equal(zonedFromWallClock('2026-09-28T16:00:00', 'Mars/Olympus_Mons'), null)
})

test('the state comes off the end of a place, or not at all', () => {
  assert.equal(stateOf('JOLIET, IL'), 'IL')
  assert.equal(stateOf('Cedar Rapids, ia'), 'IA')
  assert.equal(stateOf('Somewhere'), null)
  assert.equal(stateOf(null), null)
})

test('the job column is read for the word, not matched whole', () => {
  assert.equal(jobTypeOf('OTR Driver'), 'OTR')
  assert.equal(jobTypeOf('Regional Linehaul'), 'Regional')
  assert.equal(jobTypeOf('Owner Operator'), null)
  assert.equal(jobTypeOf(null), null)
})

test('what the API sends becomes a roster the contract accepts', () => {
  assert.deepEqual(checkRoster(built), [])
})

test('home is placed by the zone of the same name, and left unplaced when there is none', () => {
  assert.deepEqual(byCode('HBARNETT').home, { place: 'Cedar Rapids, IA', latitude: 41.9779, longitude: -91.6656 })
  assert.deepEqual(byCode('RVASQUEZ').home, { place: 'Marshalltown, IA', latitude: null, longitude: null })
})

test('position and clocks come from GeoTab; a truck that never reported has none', () => {
  const h = byCode('HBARNETT')
  assert.deepEqual(h.position, { near: 'Kansas City, MO', latitude: 39.0997, longitude: -94.5786, reportedAt: '2026-09-28T14:51:00.000Z' })
  assert.equal(h.hours?.driving, 1.5 * H)
  assert.equal(h.jobType, 'OTR')

  const r = byCode('RVASQUEZ')
  assert.equal(r.position, null)
  assert.equal(r.hours, null, 'no logs is unknown, not zero')
})

test('the truck GeoTab puts the driver in beats their regular one', () => {
  const d = byCode('RDELGADO')
  assert.equal(d.unitNo, 'Demo - 09')
  assert.equal(d.position?.near, 'Peru, IL')
})

test('a current load ends at its destination, empty at the close of the window, in the dock\'s own zone', () => {
  const load = byCode('RDELGADO').currentLoad
  assert.equal(load?.id, 'L-30412')
  assert.deepEqual(load?.finalStop, { place: 'JOLIET, IL', latitude: 41.525, longitude: -88.0817 })
  assert.equal(load?.emptyAt, '2026-09-28T16:00:00-05:00')
})

test('nothing records home time yet, so nobody is given any', () => {
  for (const d of built.drivers) assert.deepEqual(d.homeTime, { lastHomeAt: null, requestedBy: null })
})

test('an API from before home and job were added still plans, and says home is unknown', () => {
  const old = roster.map(({ home: _home, job: _job, ...rest }) => rest)
  const r = buildLoadboardRoster({ roster: old, positions, hours, zones })
  assert.equal(r.drivers[0]?.home.place, null)
  assert.equal(r.drivers[0]?.jobType, null)
  assert.ok(checkRoster(r).some((p) => /home\.place is required/.test(p)))
})

test('the planner plans every driver it is given', () => {
  const { plans } = planRoster(built, { now: '2026-09-28T15:00:00Z' })
  assert.equal(plans.length, 3)
  const rosa = plans.find((p) => p.driverCode === 'RDELGADO')
  assert.equal(rosa?.start?.from, 'final-stop')
  assert.equal(rosa?.start?.at, '2026-09-28T21:00:00.000Z')
  const rey = plans.find((p) => p.driverCode === 'RVASQUEZ')
  assert.equal(rey?.status, 'NOLOCATION')
})
