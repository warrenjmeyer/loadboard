import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dockMoment, placeFrom, rosterOnLaptop, toLoad, toLoadPlanData, toScheduleData, toStay } from './laptop.ts'
import type { LoadRow, StayRow } from './laptop.ts'
import { checkLoadPlans } from '../driver-load-plans/contract.ts'
import { checkSchedule } from '../home-time-schedule/contract.ts'
import type { ScheduleData } from '../home-time-schedule/contract.ts'
import type { LoadPlanData } from '../driver-load-plans/contract.ts'
import type { Roster } from '../get-me-home/contract.ts'

// The laptop database's rows, turned into the tabs' data -- what the host's
// API has to do with its own rows. The rows here are shaped exactly as the
// host SQL returns them (05 and 03), taken from the laptop on 2026-09-30.

const ZONES = {
  zones: [
    { name: 'LAS VEGAS, NV', latitude: 36.1699, longitude: -115.1398 },
    { name: 'Flagstaff, AZ', latitude: 35.1983, longitude: -111.6513 },
    { name: 'DUBUQUE, IA', latitude: 42.5006, longitude: -90.6646 },
  ],
}

const load = (overrides: Partial<LoadRow> = {}): LoadRow => ({
  id: 'L-10504', status: 'Covered', driverCode: 'RDELGADO',
  origin: 'Las Vegas, NV', destination: 'Flagstaff, AZ',
  pickupStart: '2026-10-01T07:00:00', pickupEnd: '2026-10-01T11:00:00',
  deliveryStart: '2026-10-01T17:00:00', deliveryEnd: '2026-10-01T21:00:00',
  miles: 251, rate: 953.8, equipment: 'Dry Van', plannedAt: '2026-09-30T11:58:00-05:00',
  ...overrides,
})

test('a dock time takes the zone of the state the dock is in', () => {
  // Las Vegas keeps Pacific time; in October that is -07:00.
  assert.equal(dockMoment('2026-10-01T07:00:00', 'Las Vegas, NV'), '2026-10-01T07:00:00-07:00')
  // Arizona keeps no daylight saving: -07:00 all year.
  assert.equal(dockMoment('2026-10-01T17:00:00', 'Flagstaff, AZ'), '2026-10-01T17:00:00-07:00')
  assert.equal(dockMoment('2026-10-01T13:00:00', 'Dubuque, IA'), '2026-10-01T13:00:00-05:00')
  assert.equal(dockMoment('2026-10-01T13:00:00', 'Somewhere'), null, 'no state, no zone -- and no guess')
  assert.equal(dockMoment(null, 'Dubuque, IA'), null)
})

test('a pickup is zoned by its origin and a delivery by its destination', () => {
  const l = toLoad(load({ origin: 'Dubuque, IA', destination: 'Las Vegas, NV' }), ZONES)
  assert.equal(l.pickupStart, '2026-10-01T07:00:00-05:00')
  assert.equal(l.deliveryEnd, '2026-10-01T21:00:00-07:00')
  assert.equal(l.plannedAt, '2026-09-30T11:58:00-05:00', 'already zoned in the database: kept as it is')
})

test('a place is found by its GeoTab zone, however the load spells the town', () => {
  assert.deepEqual(placeFrom('Las Vegas, NV', ZONES), { place: 'Las Vegas, NV', latitude: 36.1699, longitude: -115.1398 })
  assert.deepEqual(placeFrom('flagstaff,  az', ZONES), { place: 'flagstaff,  az', latitude: 35.1983, longitude: -111.6513 })
  assert.deepEqual(placeFrom('Barstow, CA', ZONES), { place: 'Barstow, CA', latitude: null, longitude: null }, 'no zone: no position, said as none')
  assert.deepEqual(placeFrom('Dubuque, IA', null), { place: 'Dubuque, IA', latitude: null, longitude: null }, 'not signed in: nothing placed')
})

test('the load plans come out as valid load plan data, with GeoTab or without', () => {
  const rows = {
    loads: [load(), load({ id: 'L-10412', status: 'Available', driverCode: null, plannedAt: null })],
    drivers: [{ driverCode: 'RDELGADO', name: 'Rosa Delgado', unitNo: 'Demo - 04', home: 'Dubuque, IA' }],
    stays: [
      { driverCode: 'RDELGADO', homeBy: '2026-10-09T18:00:00-05:00', backOut: '2026-10-12T06:00:00-05:00', status: 'APPROVED' },
      { driverCode: 'RDELGADO', homeBy: '2026-10-20T18:00:00-05:00', backOut: '2026-10-22T06:00:00-05:00', status: 'REQUESTED' },
    ],
  }
  const geotab = {
    zones: ZONES,
    positions: { asOf: '2026-09-30T17:00:00Z', trucks: [{ unitNo: 'Demo - 04', reported: true, dateTime: '2026-09-30T16:58:00Z', latitude: 36.2, longitude: -115.1, near: 'North Las Vegas, NV', driver: null }] },
    hours: { asOf: '2026-09-30T17:00:00Z', drivers: [{ driverCode: 'RDELGADO', hasAvailability: true, driving: 36000, duty: 43200, workday: null, cycle: 180000, rest: 28800, statusLabel: 'Off duty' }] },
  }
  const withGeotab = toLoadPlanData(rows, geotab)
  assert.deepEqual(checkLoadPlans(withGeotab), [])
  const rosa = withGeotab.drivers[0]!
  assert.equal(rosa.home.latitude, 42.5006)
  assert.equal(rosa.position?.place, 'North Las Vegas, NV')
  assert.equal(rosa.hours?.driving, 36000)
  assert.deepEqual(withGeotab.stays.map((s) => s.status), ['APPROVED'], 'a request is not home time a load must avoid -- yet')

  const without = toLoadPlanData(rows, { zones: null, positions: null, hours: null })
  assert.deepEqual(checkLoadPlans(without), [])
  assert.equal(without.drivers[0]!.position, null)
  assert.equal(without.drivers[0]!.hours, null)
  assert.equal(without.loads[0]!.origin.latitude, null)
})

test('a driver GeoTab has no hours for has none, not zeros', () => {
  const data = toLoadPlanData(
    { loads: [], drivers: [{ driverCode: 'CNOLAN', name: 'Cyrus Nolan', unitNo: 'Demo - 09', home: 'Dubuque, IA' }], stays: [] },
    { zones: ZONES, positions: null, hours: { asOf: 'x', drivers: [{ driverCode: 'CNOLAN', hasAvailability: false, driving: null, duty: null, workday: null, cycle: null, rest: null, statusLabel: null }] } },
  )
  assert.equal(data.drivers[0]!.hours, null)
})

test('a stored stay comes out as the schedule\'s Stay, and valid schedule data', () => {
  const row: StayRow = {
    id: '1', driverCode: 'TBOONE', status: 'APPROVED',
    homeBy: '2026-10-09T18:00:00-05:00', backOut: '2026-10-12T06:00:00-05:00', note: 'Family visit',
    requestedAt: '2026-09-30T12:34:00-05:00', decidedAt: '2026-09-30T17:34:06+00:00', decidedByUser: null,
    declineReason: null, arrivedAt: null, arrivedSource: null, leftAt: null, leftSource: null,
  }
  const stay = toStay(row)
  assert.equal(stay.decidedBy, 'Dispatch', 'decided, by somebody -- the laptop has no names to give')
  assert.equal(toStay({ ...row, status: 'REQUESTED', decidedAt: null }).decidedBy, null)
  const data = toScheduleData({ stays: [row], drivers: [{ driverCode: 'TBOONE', name: 'Terrell Boone', unitNo: 'Demo - 02', lastHomeAt: null }] })
  assert.deepEqual(checkSchedule(data), [])
})

// ---- The planner on the laptop: its loads and home time ----------------
const read = <T>(path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T
const roster = read<Roster>('../get-me-home/fixtures/roster.json')
const plans = read<LoadPlanData>('../driver-load-plans/fixtures/plans.json')
const schedule = read<ScheduleData>('../home-time-schedule/fixtures/schedule.json')
const driver = (r: Roster, code: string) => {
  const d = r.drivers.find((x) => x.driverCode === code)
  if (!d) throw new Error(`no driver ${code}`)
  return d
}

test("the planner's current load is the first on the laptop plan: the one under way, else the earliest pickup", () => {
  const r = rosterOnLaptop(roster, { plans, schedule, now: roster.asOf! })
  const rosa = driver(r, 'RDELGADO').currentLoad
  assert.equal(rosa?.id, 'L-30412', 'under way beats the Davenport load lined up after it')
  assert.equal(rosa?.finalStop.place, 'Joliet, IL')
  assert.equal(rosa?.emptyAt, '2026-09-28T16:00:00-05:00')
  assert.equal(driver(r, 'PRAMAN').currentLoad?.id, 'L-30430', 'two lined up: the earlier pickup')
  assert.equal(driver(r, 'SOAKS').currentLoad?.id, 'L-30440')
})

test('a load Millstream still shows but the laptop plan does not is gone -- the laptop decides', () => {
  const stale: Roster = { ...roster, drivers: roster.drivers.map((d) => d.driverCode === 'TBOONE'
    ? { ...d, currentLoad: { id: 'L-OLD', finalStop: { place: 'Laredo, TX', latitude: 27.5, longitude: -99.5 }, emptyAt: '2026-09-16T20:00:00-05:00' } }
    : d) }
  assert.equal(driver(rosterOnLaptop(stale, { plans, schedule, now: roster.asOf! }), 'TBOONE').currentLoad, null)
})

test("a road route home measured from Millstream's load is not reused", () => {
  assert.ok(driver(roster, 'PRAMAN').routeHome, 'the fixture has one')
  assert.equal(driver(rosterOnLaptop(roster, { plans, schedule, now: roster.asOf! }), 'PRAMAN').routeHome, null)
})

test("home time comes from the laptop's stays, and a scoped driver's lastHomeAt wins", () => {
  const r = rosterOnLaptop(roster, { plans, schedule, now: roster.asOf! })
  assert.equal(driver(r, 'TBOONE').homeTime.requestedBy, '2026-09-29T18:00:00-05:00')
  assert.equal(driver(r, 'TBOONE').homeTime.lastHomeAt, '2026-09-12T13:00:00Z', 'from his DONE stay')
  const scoped = { ...schedule, drivers: schedule.drivers.map((d) => (d.driverCode === 'TBOONE' ? { ...d, lastHomeAt: '2026-09-20T12:00:00Z' } : d)) }
  assert.equal(driver(rosterOnLaptop(roster, { plans, schedule: scoped, now: roster.asOf! }), 'TBOONE').homeTime.lastHomeAt, '2026-09-20T12:00:00Z')
})

test("positions and hours stay GeoTab's", () => {
  const r = rosterOnLaptop(roster, { plans, schedule, now: roster.asOf! })
  assert.deepEqual(driver(r, 'HBARNETT').position, driver(roster, 'HBARNETT').position)
  assert.deepEqual(driver(r, 'HBARNETT').hours, driver(roster, 'HBARNETT').hours)
})

