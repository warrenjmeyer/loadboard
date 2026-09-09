const test = require('node:test')
const assert = require('node:assert/strict')
const rules = require('./stopRules')

const PICKUP = { stopType: 'Pickup', place: 'Dubuque, IA', name: 'Mississippi Valley Foods', address: '1200 Kerper Blvd', phone: '563-555-0140', windowStart: '2026-09-10T08:00', windowEnd: '2026-09-10T12:00' }
const DROP1 = { stopType: 'Delivery', place: 'Rockford, IL', name: 'Jewel DC', windowStart: '2026-09-10T15:00' }
const DROP2 = { stopType: 'Delivery', place: 'Chicago, IL', name: 'Great Lakes Produce Co.', referenceNo: 'PO-9981', notes: 'dock 14' }

test('a valid list is cleaned and renumbered in the order given', () => {
  const { errors, stops } = rules.validateStops([{ ...PICKUP, stopId: 7 }, DROP1, { ...DROP2, place: '  Chicago, IL ' }])
  assert.deepEqual(errors, [])
  assert.deepEqual(stops.map((s) => [s.seq, s.stopType, s.place, s.stopId]), [[1, 'Pickup', 'Dubuque, IA', 7], [2, 'Delivery', 'Rockford, IL', null], [3, 'Delivery', 'Chicago, IL', null]])
  assert.equal(stops[0].windowStart, '2026-09-10T08:00:00')
  assert.equal(stops[1].windowEnd, null)
  assert.equal(stops[2].referenceNo, 'PO-9981')
})

test('first must be a pickup, last a delivery, at least two, each with a place', () => {
  assert.ok(rules.validateStops([PICKUP]).errors.some((e) => e.includes('at least')))
  assert.ok(rules.validateStops([DROP1, PICKUP]).errors.some((e) => e.includes('first stop must be a pickup')))
  assert.ok(rules.validateStops([DROP1, PICKUP]).errors.some((e) => e.includes('last stop must be a delivery')))
  assert.deepEqual(rules.validateStops([PICKUP, { stopType: 'Delivery' }]).errors, ['Stop 2: city, state is required.'])
  assert.ok(rules.validateStops([PICKUP, { stopType: 'Drop', place: 'X' }]).errors[0].includes('Pickup or Delivery'))
  assert.ok(rules.validateStops([{ ...PICKUP, windowEnd: '2026-09-10T07:00' }, DROP2]).errors[0].includes('ends before it starts'))
  assert.ok(rules.validateStops('nope').errors[0].includes('list'))
})

test('the summary is the first and the last stop', () => {
  const { stops } = rules.validateStops([PICKUP, DROP1, DROP2])
  assert.deepEqual(rules.summaryFrom(stops), {
    origin: 'Dubuque, IA', shipperName: 'Mississippi Valley Foods', shipperAddress: '1200 Kerper Blvd', shipperPhone: '563-555-0140',
    pickupStart: '2026-09-10T08:00:00', pickupEnd: '2026-09-10T12:00:00',
    destination: 'Chicago, IL', consigneeName: 'Great Lakes Produce Co.', consigneeAddress: null, consigneePhone: null,
    deliveryStart: null, deliveryEnd: null,
  })
  assert.deepEqual(rules.summaryFrom([]), {})
})

test('a load with no stops list gets the two its columns describe', () => {
  const stops = rules.stopsFromSummary({ origin: 'A, IA', destination: 'B, IL', shipperName: 'S', consigneePhone: '1', pickupStart: '2026-09-10T08:00:00' })
  assert.equal(stops.length, 2)
  assert.deepEqual([stops[0].stopType, stops[0].place, stops[0].name, stops[0].windowStart], ['Pickup', 'A, IA', 'S', '2026-09-10T08:00:00'])
  assert.deepEqual([stops[1].stopType, stops[1].place, stops[1].phone, stops[1].name], ['Delivery', 'B, IL', '1', null])
})

const SAVED = [
  { stopId: 1, seq: 1, stopType: 'Pickup', place: 'Dubuque, IA', arrivedUtc: null, departedUtc: null },
  { stopId: 2, seq: 2, stopType: 'Delivery', place: 'Rockford, IL', arrivedUtc: null, departedUtc: null },
  { stopId: 3, seq: 3, stopType: 'Delivery', place: 'Chicago, IL', arrivedUtc: null, departedUtc: null },
]
const done = (s, arrived = '2026-09-10T08:10:00', departed = '2026-09-10T09:00:00') => ({ ...s, arrivedUtc: arrived, departedUtc: departed })

test('progress says which stop is current', () => {
  assert.deepEqual(rules.progress(SAVED), { total: 3, done: 0, current: SAVED[0], currentSeq: 1, atDock: false, complete: false })
  const half = [done(SAVED[0]), { ...SAVED[1], arrivedUtc: '2026-09-10T14:00:00' }, SAVED[2]]
  const p = rules.progress(half)
  assert.equal(p.done, 1)
  assert.equal(p.currentSeq, 2)
  assert.equal(p.atDock, true)
  assert.equal(rules.progress([done(SAVED[0]), done(SAVED[1]), done(SAVED[2])]).complete, true)
  assert.equal(rules.progress([]).current, null)
})

const DRIVER = { role: 'driver', driverCode: 'JSMITH' }
const OTHER = { role: 'driver', driverCode: 'SOAKS' }
const DISPATCH = { role: 'dispatcher' }
const COVERED = { status: 'Covered', driverCode: 'JSMITH' }
const NOW = new Date('2026-09-10T13:05:00.000Z')

test('the driver on the load checks in, in order, and departing the pickup starts the trip', () => {
  const arrive = rules.planCheckIn(COVERED, SAVED, 1, 'arrive', DRIVER, NOW)
  assert.deepEqual(arrive.errors, [])
  assert.equal(arrive.stop.arrivedUtc, '2026-09-10T13:05:00')
  assert.equal(arrive.loadStatus, 'Covered')
  assert.equal(arrive.events[0].type, 'Arrived')
  assert.equal(arrive.events[0].detail, 'Arrived at pickup 1 of 3, Dubuque, IA')

  const arrived = [{ ...SAVED[0], arrivedUtc: '2026-09-10T13:05:00' }, SAVED[1], SAVED[2]]
  const depart = rules.planCheckIn(COVERED, arrived, 1, 'depart', DRIVER, NOW)
  assert.deepEqual(depart.errors, [])
  assert.equal(depart.loadStatus, 'In Transit')
  assert.deepEqual(depart.events.map((e) => e.type), ['Departed', 'Status'])

  // Departing a delivery does not deliver the load.
  const atDrop = [done(SAVED[0]), { ...SAVED[1], arrivedUtc: '2026-09-10T14:00:00' }, SAVED[2]]
  const leave = rules.planCheckIn({ status: 'In Transit', driverCode: 'JSMITH' }, atDrop, 2, 'depart', DRIVER, NOW)
  assert.equal(leave.loadStatus, 'In Transit')
  assert.equal(leave.events.length, 1)
})

test('check-ins out of order, twice, or by the wrong person are refused', () => {
  assert.ok(rules.planCheckIn(COVERED, SAVED, 2, 'arrive', DRIVER, NOW).errors[0].includes('Stop 1 comes first'))
  assert.ok(rules.planCheckIn(COVERED, SAVED, 1, 'depart', DRIVER, NOW).errors[0].includes('Arrive before'))
  const arrived = [{ ...SAVED[0], arrivedUtc: '2026-09-10T13:05:00' }, SAVED[1], SAVED[2]]
  assert.ok(rules.planCheckIn(COVERED, arrived, 1, 'arrive', DRIVER, NOW).errors[0].includes('Already arrived'))
  assert.ok(rules.planCheckIn(COVERED, [done(SAVED[0]), SAVED[1], SAVED[2]], 1, 'arrive', DRIVER, NOW).errors[0].includes('already done'))
  assert.equal(rules.planCheckIn(COVERED, SAVED, 1, 'arrive', OTHER, NOW).forbidden, true)
  assert.equal(rules.planCheckIn(COVERED, SAVED, 1, 'arrive', null, NOW).forbidden, true)
  assert.deepEqual(rules.planCheckIn(COVERED, SAVED, 1, 'arrive', DISPATCH, NOW).errors, [])
  assert.ok(rules.planCheckIn({ status: 'Available', driverCode: null }, SAVED, 1, 'arrive', DISPATCH, NOW).errors[0].includes('available load'))
  assert.equal(rules.planCheckIn(COVERED, SAVED, 99, 'arrive', DISPATCH, NOW).notFound, true)
  assert.ok(rules.planCheckIn(COVERED, SAVED, 1, 'wave', DISPATCH, NOW).errors[0].includes('arrive or depart'))
})

test('the public view of a stop keeps where and when, drops who', () => {
  const s = rules.publicStop({ stopId: 1, seq: 1, stopType: 'Pickup', place: 'Dubuque, IA', name: 'X', phone: '1', windowStart: '2026-09-10T08:00:00', windowEnd: null, arrivedUtc: '2026-09-10T08:10:00' })
  assert.equal(s.place, 'Dubuque, IA')
  assert.equal(s.windowStart, '2026-09-10T08:00:00')
  assert.equal(s.name, null)
  assert.equal(s.phone, null)
  assert.equal(s.arrivedUtc, null)
})
