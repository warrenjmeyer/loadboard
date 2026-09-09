const test = require('node:test')
const assert = require('node:assert/strict')
const rules = require('./loadRules')

// The people who show up in the tests.
const dispatcher = { role: 'dispatcher', driverCode: null }
const admin = { role: 'admin', driverCode: null }
const smith = { role: 'driver', driverCode: 'JSMITH' }
const oaks = { role: 'driver', driverCode: 'SOAKS' }
const pending = { role: 'none', driverCode: null }

function load(overrides = {}) {
  return {
    id: 'L-10412', origin: 'Dubuque, IA', destination: 'Chicago, IL',
    miles: 182, rate: 585, equipment: 'Reefer', status: 'Available',
    driverCode: null, unitNo: null, deliveredDate: null,
    pickupStart: null, pickupEnd: null, deliveryStart: null, deliveryEnd: null,
    customerName: null, referenceNo: null, shipperName: null, shipperAddress: null, shipperPhone: null,
    consigneeName: null, consigneeAddress: null, consigneePhone: null,
    commodity: null, weightLbs: null, pieces: null, hazmat: false, tempF: null, notes: null,
    ...overrides,
  }
}

const covered = () => load({ status: 'Covered', driverCode: 'JSMITH', unitNo: 'Demo - 01' })
const inTransit = () => load({ status: 'In Transit', driverCode: 'JSMITH', unitNo: 'Demo - 01' })
const delivered = () => load({ status: 'Delivered', driverCode: 'JSMITH', unitNo: 'Demo - 01', deliveredDate: '2026-09-08' })

// ---------------------------------------------------------------------------
// validateFields
// ---------------------------------------------------------------------------
test('a create needs every required field and fills the optional ones', () => {
  const { errors, fields } = rules.validateFields({
    origin: ' Dubuque, IA ', destination: 'Chicago, IL', miles: '182', rate: '585.005', equipment: 'Reefer',
  })
  assert.deepEqual(errors, [])
  assert.equal(fields.origin, 'Dubuque, IA')
  assert.equal(fields.miles, 182)
  assert.equal(fields.rate, 585.01)
  assert.equal(fields.hazmat, false)
  assert.equal(fields.notes, null)
  assert.ok('pickupStart' in fields)
})

test('a create without required fields says which', () => {
  const { errors } = rules.validateFields({ miles: 0, rate: -1, equipment: 'Tanker' })
  assert.ok(errors.includes('Origin is required.'))
  assert.ok(errors.includes('Destination is required.'))
  assert.ok(errors.includes('Miles must be above zero.'))
  assert.ok(errors.includes('Rate must be zero or more.'))
  assert.ok(errors.some((e) => e.startsWith('Equipment must be one of')))
})

test('a partial validation only looks at what was sent', () => {
  const { errors, fields } = rules.validateFields({ commodity: 'Frozen pizza', tempF: '-10' }, { partial: true })
  assert.deepEqual(errors, [])
  assert.deepEqual(fields, { commodity: 'Frozen pizza', tempF: -10 })
})

test('a partial validation still refuses to blank a required field', () => {
  const { errors } = rules.validateFields({ origin: '' }, { partial: true })
  assert.deepEqual(errors, ['Origin is required.'])
})

test('datetimes are normalised and impossible ones refused', () => {
  assert.equal(rules.normaliseDatetime('2026-09-10T08:00'), '2026-09-10T08:00:00')
  assert.equal(rules.normaliseDatetime('2026-09-10'), '2026-09-10T00:00:00')
  assert.equal(rules.normaliseDatetime('2026-02-31T08:00'), null)
  assert.equal(rules.normaliseDatetime('2026-09-10T25:00'), null)
  assert.equal(rules.normaliseDatetime('tomorrow'), null)
})

test('a window that ends before it starts is refused', () => {
  const { errors } = rules.validateFields(
    { pickupStart: '2026-09-10T14:00', pickupEnd: '2026-09-10T08:00' },
    { partial: true }
  )
  assert.deepEqual(errors, ['Pickup window ends before it starts.'])
})

// ---------------------------------------------------------------------------
// allowedTransitions / actionsFor
// ---------------------------------------------------------------------------
test('staff get the full table; nobody else gets anything they should not', () => {
  assert.deepEqual(rules.allowedTransitions(dispatcher, load()), ['Covered', 'Cancelled'])
  assert.deepEqual(rules.allowedTransitions(admin, delivered()), ['In Transit'])
  assert.deepEqual(rules.allowedTransitions(pending, covered()), [])
  assert.deepEqual(rules.allowedTransitions(null, covered()), [])
})

test('the driver on the load may only go forward', () => {
  assert.deepEqual(rules.allowedTransitions(smith, covered()), ['In Transit'])
  assert.deepEqual(rules.allowedTransitions(smith, inTransit()), ['Delivered'])
  assert.deepEqual(rules.allowedTransitions(smith, delivered()), [])
  // Somebody else's load is nothing to do with them.
  assert.deepEqual(rules.allowedTransitions(oaks, covered()), [])
})

test('actions say what the page may offer', () => {
  assert.deepEqual(rules.actionsFor(dispatcher, load()), { canEdit: true, canAssign: true, transitions: ['Covered', 'Cancelled'] })
  assert.deepEqual(rules.actionsFor(dispatcher, delivered()), { canEdit: true, canAssign: false, transitions: ['In Transit'] })
  assert.deepEqual(rules.actionsFor(smith, covered()), { canEdit: false, canAssign: false, transitions: ['In Transit'] })
  assert.deepEqual(rules.actionsFor(null, load()), { canEdit: false, canAssign: false, transitions: [] })
})

// ---------------------------------------------------------------------------
// planChange
// ---------------------------------------------------------------------------
test('assigning a driver covers the load', () => {
  const { errors, next, events } = rules.planChange(load(), { driverCode: 'jsmith', unitNo: 'Demo - 01' }, dispatcher)
  assert.equal(errors, undefined)
  assert.equal(next.status, 'Covered')
  assert.equal(next.driverCode, 'JSMITH')
  assert.equal(next.unitNo, 'Demo - 01')
  assert.equal(events.length, 2)
  assert.equal(events[0].type, 'Assigned')
  assert.deepEqual(events[1], { type: 'Status', fromStatus: 'Available', toStatus: 'Covered', detail: null })
})

test('removing the driver uncovers it and clears the unit', () => {
  const { next, events } = rules.planChange(covered(), { driverCode: null }, dispatcher)
  assert.equal(next.status, 'Available')
  assert.equal(next.driverCode, null)
  assert.equal(next.unitNo, null)
  assert.equal(events[0].type, 'Unassigned')
})

test('a driver cannot assign, edit, or touch somebody else\'s load', () => {
  assert.equal(rules.planChange(load(), { driverCode: 'JSMITH' }, smith).forbidden, true)
  assert.equal(rules.planChange(covered(), { miles: 200 }, smith).forbidden, true)
  const other = rules.planChange(covered(), { status: 'In Transit' }, oaks)
  assert.equal(other.forbidden, true)
  assert.match(other.errors[0], /Only a dispatcher/)
})

test('the driver on the load reports pickup and delivery', () => {
  const picked = rules.planChange(covered(), { status: 'In Transit' }, smith)
  assert.equal(picked.next.status, 'In Transit')
  assert.equal(picked.next.deliveredDate, null)

  const done = rules.planChange(inTransit(), { status: 'Delivered', deliveredDate: '2026-09-09' }, smith, { today: '2026-09-10' })
  assert.equal(done.next.status, 'Delivered')
  assert.equal(done.next.deliveredDate, '2026-09-09')
  assert.deepEqual(done.events, [{ type: 'Status', fromStatus: 'In Transit', toStatus: 'Delivered', detail: 'Delivered 2026-09-09' }])
})

test('delivered defaults to today when no date is sent', () => {
  const { next } = rules.planChange(inTransit(), { status: 'Delivered' }, dispatcher, { today: '2026-09-10' })
  assert.equal(next.deliveredDate, '2026-09-10')
})

test('a driver may not go backwards, and the message says who can', () => {
  const r = rules.planChange(inTransit(), { status: 'Covered' }, smith)
  assert.equal(r.forbidden, true)
  assert.match(r.errors[0], /Only a dispatcher/)
})

test('an impossible move is a 400, not a 403', () => {
  const r = rules.planChange(load(), { status: 'Delivered' }, dispatcher)
  assert.ok(!r.forbidden)
  assert.match(r.errors[0], /cannot go from Available to Delivered/)
})

test('covering with no driver is refused in words', () => {
  const r = rules.planChange(load(), { status: 'Covered' }, dispatcher)
  assert.deepEqual(r.errors, ['Assign a driver before marking the load covered.'])
})

test('un-delivering clears the date and keeps the driver', () => {
  const { next, events } = rules.planChange(delivered(), { status: 'In Transit' }, admin)
  assert.equal(next.status, 'In Transit')
  assert.equal(next.deliveredDate, null)
  assert.equal(next.driverCode, 'JSMITH')
  assert.equal(events[0].type, 'Status')
})

test('a delivered load cannot be reassigned without moving it back', () => {
  const r = rules.planChange(delivered(), { driverCode: 'SOAKS' }, dispatcher)
  assert.match(r.errors[0], /delivered load cannot be reassigned/)
})

test('cancelling keeps the driver as a record and reinstating clears it', () => {
  const cancelled = rules.planChange(covered(), { status: 'Cancelled' }, dispatcher)
  assert.equal(cancelled.next.status, 'Cancelled')
  assert.equal(cancelled.next.driverCode, 'JSMITH')

  const back = rules.planChange(cancelled.next, { status: 'Available' }, dispatcher)
  assert.equal(back.next.status, 'Available')
  assert.equal(back.next.driverCode, null)
})

test('the same status again is a no-op, so a retried PATCH is harmless', () => {
  const r = rules.planChange(inTransit(), { status: 'In Transit' }, smith)
  assert.equal(r.errors, undefined)
  assert.deepEqual(r.events, [])
  assert.equal(r.next.status, 'In Transit')
})

test('editing details records what changed and nothing else', () => {
  const { next, events } = rules.planChange(covered(), { miles: 182, commodity: 'Frozen pizza', tempF: -10 }, dispatcher)
  assert.equal(next.commodity, 'Frozen pizza')
  assert.equal(next.status, 'Covered')
  assert.deepEqual(events, [{ type: 'Edited', detail: 'Changed commodity, temperature' }])
})

test('an empty body is nothing to change', () => {
  assert.deepEqual(rules.planChange(load(), {}, dispatcher).errors, ['Nothing to change.'])
})

test('a bad driver code is refused before it reaches the foreign key', () => {
  const r = rules.planChange(load(), { driverCode: 'not a code' }, dispatcher)
  assert.deepEqual(r.errors, ['That driver code is not valid.'])
})

test('a trailer rides along with the assignment and leaves with it', () => {
  const on = rules.planChange(load(), { driverCode: 'JSMITH', unitNo: 'Demo - 15', trailerNo: 'T-201' }, dispatcher)
  assert.equal(on.errors, undefined)
  assert.equal(on.next.trailerNo, 'T-201')
  assert.equal(on.next.status, 'Covered')

  const swap = rules.planChange(on.next, { trailerNo: 'T-202' }, dispatcher)
  assert.deepEqual(swap.events, [{ type: 'Edited', detail: 'Changed trailer to T-202' }])
  assert.equal(swap.next.status, 'Covered')

  const off = rules.planChange(swap.next, { driverCode: null }, dispatcher)
  assert.equal(off.next.status, 'Available')
  assert.equal(off.next.trailerNo, null)
  assert.equal(off.next.unitNo, null)
})

test('a driver cannot pick their own trailer either', () => {
  assert.equal(rules.planChange(covered(), { trailerNo: 'T-201' }, smith).forbidden, true)
})
