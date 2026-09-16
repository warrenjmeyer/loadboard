const test = require('node:test')
const assert = require('node:assert/strict')
const rules = require('./telematicsRules')

const NOW = new Date('2026-09-09T15:00:00.000Z')

test('a .NET TimeSpan becomes whole seconds, sign and days kept', () => {
  assert.equal(rules.parseTimeSpan('10:15:00'), 36900)
  assert.equal(rules.parseTimeSpan('00:00:00.0000000'), 0)
  assert.equal(rules.parseTimeSpan('1.02:03:04'), 93784)
  assert.equal(rules.parseTimeSpan('-00:30:00'), -1800)
  assert.equal(rules.parseTimeSpan('8:00:00.5'), 28800)
  assert.equal(rules.parseTimeSpan(3600), 3600)
})

test('an unreadable duration is null, not zero', () => {
  assert.equal(rules.parseTimeSpan(null), null)
  assert.equal(rules.parseTimeSpan(undefined), null)
  assert.equal(rules.parseTimeSpan('PT10H'), null)
  assert.equal(rules.parseTimeSpan(''), null)
  assert.equal(rules.parseTimeSpan('soon'), null)
})

test('report age is whole minutes and never negative', () => {
  assert.equal(rules.ageMinutes('2026-09-09T14:37:30.000Z', NOW), 22)
  assert.equal(rules.ageMinutes('2026-09-09T15:00:20.000Z', NOW), 0)
  assert.equal(rules.ageMinutes(null, NOW), null)
  assert.equal(rules.ageMinutes('yesterday', NOW), null)
})

test('speed converts from km/h and rounds', () => {
  assert.equal(rules.kphToMph(100), 62)
  assert.equal(rules.kphToMph(0), 0)
  assert.equal(rules.kphToMph(null), null)
  assert.equal(rules.kphToMph('fast'), null)
})

const USERS = [
  { id: 'b10', firstName: 'Dale', lastName: 'Foster', isDriver: true },
  { id: 'b15', firstName: 'Hollis', lastName: 'Barnett', isDriver: true },
  { id: 'b99', firstName: 'Warren', lastName: 'Meyer', isDriver: false },
]
const DRIVERS = [
  { driverCode: 'DFOSTER', firstName: 'Dale', lastName: 'Foster', unitNo: 'Demo - 05' },
  { driverCode: 'HBARNETT', firstName: 'hollis', lastName: ' Barnett ', unitNo: 'Demo - 01' },
  { driverCode: 'NOBODY', firstName: 'No', lastName: 'Match', unitNo: null },
]

test('drivers match Geotab users by name, case and spacing aside', () => {
  const m = rules.matchDrivers(USERS, DRIVERS)
  assert.equal(m.byCode.get('DFOSTER'), 'b10')
  assert.equal(m.byCode.get('HBARNETT'), 'b15')
  assert.equal(m.byUserId.get('b15'), 'HBARNETT')
  assert.deepEqual(m.unmatched, ['NOBODY'])
})

const TRUCKS = [
  { unitNo: 'Demo - 05', status: 'Active', regularDriver: { driverCode: 'DFOSTER', name: 'Dale Foster' }, currentLoad: { id: 'L-10413', status: 'In Transit', destination: 'Kansas City, MO' } },
  { unitNo: 'Demo - 01', status: 'Active', regularDriver: { driverCode: 'HBARNETT', name: 'Hollis Barnett' }, currentLoad: null },
  { unitNo: 'Demo - 30', status: 'Shop', regularDriver: null, currentLoad: null },
]
const DEVICES = [
  { id: 'b5', name: 'Demo - 05' },
  { id: 'b1', name: 'Demo - 01' },
  { id: 'b7', name: 'Demo - 07' },
]
const STATUSES = [
  { device: { id: 'b5' }, driver: { id: 'b15' }, dateTime: '2026-09-09T14:55:00.000Z', latitude: 41.5868123, longitude: -93.6249876, speed: 104.6, bearing: 271.6, isDriving: true, isDeviceCommunicating: true },
  { device: { id: 'b1' }, driver: 'UnknownDriverId', dateTime: '2026-09-08T09:00:00.000Z', latitude: 42.5, longitude: -90.66, speed: 0, bearing: -1, isDriving: false, isDeviceCommunicating: false },
]

test('positions: one row per app truck, annotated by Geotab, in unit order', () => {
  const rows = rules.positionRows({ trucks: TRUCKS, devices: DEVICES, statuses: STATUSES, users: USERS, drivers: DRIVERS }, NOW)
  assert.deepEqual(rows.map((r) => r.unitNo), ['Demo - 01', 'Demo - 05', 'Demo - 30'])

  const five = rows[1]
  assert.equal(five.geotabDeviceId, 'b5')
  assert.equal(five.reported, true)
  assert.equal(five.ageMinutes, 5)
  assert.equal(five.latitude, 41.58681)
  assert.equal(five.longitude, -93.62499)
  assert.equal(five.speedMph, 65)
  assert.equal(five.bearing, 272)
  assert.equal(five.isDriving, true)
  assert.equal(five.communicating, true)
  // Geotab says Barnett is in Foster's truck. Both facts are reported.
  assert.deepEqual(five.driver, { driverCode: 'HBARNETT', name: 'Hollis Barnett' })
  assert.equal(five.regularDriver.driverCode, 'DFOSTER')
  assert.equal(five.currentLoad.id, 'L-10413')

  const one = rows[0]
  assert.equal(one.driver, null)
  assert.equal(one.bearing, null)
  assert.equal(one.speedMph, 0)
  assert.equal(one.communicating, false)
  assert.equal(one.ageMinutes, 1800)

  // No device with that name: the truck is listed, unreported, not dropped.
  const thirty = rows[2]
  assert.equal(thirty.geotabDeviceId, null)
  assert.equal(thirty.reported, false)
  assert.equal(thirty.latitude, null)
})

test('a device with no status yet is reported: false, with its id', () => {
  const rows = rules.positionRows({ trucks: [TRUCKS[0]], devices: DEVICES, statuses: [], users: USERS, drivers: DRIVERS }, NOW)
  assert.equal(rows[0].geotabDeviceId, 'b5')
  assert.equal(rows[0].reported, false)
})

test('the latest duty log wins, and non-duty entries are ignored', () => {
  const logs = [
    { status: 'ON', dateTime: '2026-09-09T06:00:00.000Z' },
    { status: 'Certified', dateTime: '2026-09-09T14:59:00.000Z' },
    { status: 'D', dateTime: '2026-09-09T13:00:00.000Z' },
    { status: 'OFF', dateTime: '2026-09-08T20:00:00.000Z' },
  ]
  assert.equal(rules.latestDutyLog(logs).status, 'D')
  assert.equal(rules.latestDutyLog([]), null)
  assert.equal(rules.latestDutyLog(null), null)
})

test('an hours row reads the clocks, the current status and the exemptions', () => {
  const driver = { driverCode: 'DFOSTER', firstName: 'Dale', lastName: 'Foster', driverType: 'COMPANY', unitNo: 'Demo - 05', geotabUserId: 'b10' }
  const availability = {
    driver: { id: 'b10' }, driving: '08:15:00', duty: '10:40:00', workday: '11:00:00', cycle: '2.03:00:00',
    rest: '00:00:00', cycleRest: '1.10:00:00', is16HourExemptionAvailable: true, isAdverseDrivingExemptionAvailable: false,
  }
  const logs = [{ status: 'D', dateTime: '2026-09-09T13:00:00.000Z' }]
  const row = rules.hosRow(driver, availability, logs, NOW)
  assert.equal(row.name, 'Dale Foster')
  assert.equal(row.matched, true)
  assert.equal(row.status, 'D')
  assert.equal(row.statusLabel, 'Driving')
  assert.equal(row.statusGroup, 'D')
  assert.equal(row.statusMinutes, 120)
  assert.equal(row.hasAvailability, true)
  assert.equal(row.driving, 29700)
  assert.equal(row.duty, 38400)
  assert.equal(row.cycle, 183600)
  assert.equal(row.rest, 0)
  assert.deepEqual(row.exemptions, { sixteenHour: true, adverseDriving: false, offDutyDeferral: false })
})

test('a driver Geotab knows nothing about still gets a row, all dashes', () => {
  const driver = { driverCode: 'NOBODY', firstName: 'No', lastName: 'Match', driverType: 'COMPANY', unitNo: null, geotabUserId: null }
  const row = rules.hosRow(driver, null, [], NOW)
  assert.equal(row.matched, false)
  assert.equal(row.status, null)
  assert.equal(row.hasAvailability, false)
  assert.equal(row.driving, null)
  assert.equal(row.cycle, null)
})

test('a Geotab address becomes "City, ST"', () => {
  assert.equal(rules.nearFrom({ city: 'Ankeny', region: 'Iowa', country: 'United States', formattedAddress: '123 SE Oralabor Rd, Ankeny, IA 50021' }), 'Ankeny, IA')
  assert.equal(rules.nearFrom({ city: 'Las Vegas', region: 'NV' }), 'Las Vegas, NV')
  assert.equal(rules.nearFrom({ city: 'Winnipeg', region: 'Manitoba' }), 'Winnipeg, MB')
  assert.equal(rules.nearFrom({ city: 'Somewhere', region: 'Yucatán' }), 'Somewhere, Yucatán')
  assert.equal(rules.nearFrom({ city: 'Ankeny', region: '' }), 'Ankeny')
  assert.equal(rules.nearFrom({ city: '', region: '', formattedAddress: 'I-80 W, Nebraska' }), 'I-80 W, Nebraska')
  assert.equal(rules.nearFrom({}), null)
  assert.equal(rules.nearFrom(null), null)
})

test('positions a hundred metres apart share a place key', () => {
  assert.equal(rules.placeKey(41.586812, -93.624987), '41.587,-93.625')
  assert.equal(rules.placeKey(41.58690, -93.62510), '41.587,-93.625')
  assert.notEqual(rules.placeKey(41.59, -93.62), rules.placeKey(41.587, -93.625))
  assert.equal(rules.placeKey(null, -93.6), null)
})

test('the tightest clock is the smallest, and negative means over', () => {
  assert.deepEqual(rules.tightestClock({ driving: 29700, duty: 3600, workday: 39600, cycle: 183600 }), { clock: 'duty', seconds: 3600, over: false })
  assert.deepEqual(rules.tightestClock({ driving: -600, duty: 3600, workday: null, cycle: null }), { clock: 'driving', seconds: -600, over: true })
  assert.equal(rules.tightestClock({ driving: null, duty: null, workday: null, cycle: null }), null)
})

// ---------------------------------------------------------------------------
// Zones: the join between a stop that says "Waterloo, IA" and a geofence that
// says the same thing. Every failure here is a pin in the wrong place on a
// map, which is the kind of wrong that looks authoritative.
// ---------------------------------------------------------------------------
const BOX = [
  { x: -92.3789, y: 42.4658 },
  { x: -92.3063, y: 42.4658 },
  { x: -92.3063, y: 42.5198 },
  { x: -92.3789, y: 42.5198 },
]

test('a zone name matches however it was typed', () => {
  assert.equal(rules.zoneKey('Waterloo, IA'), 'WATERLOO, IA')
  assert.equal(rules.zoneKey('  waterloo,   ia  '), 'WATERLOO, IA')
  // Loose about case and spacing, strict about everything else: a stop
  // typed without the comma is a different place, not this one.
  assert.notEqual(rules.zoneKey('Waterloo IA'), rules.zoneKey('Waterloo, IA'))
  assert.equal(rules.zoneKey(null), '')
})

test('a zone centre is the middle of its box', () => {
  const c = rules.zoneCentre(BOX)
  assert.equal(Math.round(c.latitude * 1e4) / 1e4, 42.4928)
  assert.equal(Math.round(c.longitude * 1e4) / 1e4, -92.3426)
  assert.deepEqual([c.north, c.south], [42.5198, 42.4658])
})

test('a zone with no usable points is dropped, not plotted in the Atlantic', () => {
  // (0, 0) is off the coast of Africa. A zone that lands there on a map is
  // worse than a zone that is absent from it.
  assert.equal(rules.zoneCentre([]), null)
  assert.equal(rules.zoneCentre(null), null)
  assert.equal(rules.zoneCentre([{ x: null, y: 42 }]), null)
  const rows = rules.zoneRows([
    { id: 'b12', name: 'WATERLOO, IA', points: BOX },
    { id: 'bad', name: 'NOWHERE', points: [] },
    { id: 'b2', name: 'CHICAGO, IL', points: [{ x: -87.66, y: 41.85 }, { x: -87.6, y: 41.9 }] },
  ])
  assert.deepEqual(rows.map((r) => r.id), ['b2', 'b12'])
  assert.deepEqual(rows.map((r) => r.key), ['CHICAGO, IL', 'WATERLOO, IA'])
  assert.equal(rules.zoneRows(null).length, 0)
})

// ---------------------------------------------------------------------------
// The breadcrumb trail.
// ---------------------------------------------------------------------------

test('a trail comes back in time order, whatever order it arrived in', () => {
  // Geotab returns LogRecords in no guaranteed order, and a trail drawn in
  // the order they happen to arrive is a scribble rather than a journey.
  const trail = rules.trailPoints([
    { dateTime: '2026-09-16T14:05:00.000Z', latitude: 36.12, longitude: -115.10 },
    { dateTime: '2026-09-16T14:00:00.000Z', latitude: 36.17, longitude: -115.14 },
    { dateTime: '2026-09-16T14:10:00.000Z', latitude: 36.05, longitude: -115.02 },
  ])
  assert.deepEqual(trail, [[36.17, -115.14], [36.12, -115.1], [36.05, -115.02]])
})

test('a fix at null island is dropped, not drawn', () => {
  // Geotab reports 0,0 for a device with no fix yet. It is a real place in
  // the Atlantic, and one of them puts a line from Nevada across the ocean
  // and back.
  const trail = rules.trailPoints([
    { dateTime: '2026-09-16T14:00:00.000Z', latitude: 36.17, longitude: -115.14 },
    { dateTime: '2026-09-16T14:01:00.000Z', latitude: 0, longitude: 0 },
    { dateTime: '2026-09-16T14:02:00.000Z', latitude: 36.12, longitude: -115.10 },
  ])
  assert.equal(trail.length, 2)
  assert.ok(trail.every(([lat, lon]) => lat !== 0 && lon !== 0))
})

test('a record missing a time or a coordinate is not a breadcrumb', () => {
  assert.deepEqual(rules.trailPoints([
    { latitude: 36.17, longitude: -115.14 },                     // no time
    { dateTime: '2026-09-16T14:00:00.000Z', latitude: 36.17 },   // no longitude
    { dateTime: '2026-09-16T14:01:00.000Z', latitude: null, longitude: -115.1 },
  ]), [])
  assert.deepEqual(rules.trailPoints([]), [])
  assert.deepEqual(rules.trailPoints(null), [])
})
