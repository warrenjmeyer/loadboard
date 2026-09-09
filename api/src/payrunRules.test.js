const test = require('node:test')
const assert = require('node:assert/strict')
const rules = require('./payrunRules')

const company = { name: 'James Smith', driverType: 'COMPANY', payBasis: null, payRate: 0.62, unitNo: 'Demo - 15' }
const mileage = { name: 'Rey Vasquez', driverType: 'OWNER', payBasis: 'MILEAGE', payRate: 1.88, unitNo: 'Demo - 21' }
const percent = { name: 'Miriam Okonkwo', driverType: 'OWNER', payBasis: 'PERCENTAGE', payRate: 0.68, unitNo: 'Demo - 23' }

const load = (o = {}) => ({
  id: 'L-30001', origin: 'Dubuque, IA', destination: 'Chicago, IL', miles: 182, emptyMiles: 20, rate: 530,
  unitNo: null, driverCode: 'JSMITH', deliveredDate: '2026-09-02', ...o,
})

test('a company driver is paid on total miles at their rate', () => {
  const r = rules.routeFor(load(), company)
  assert.equal(r.totalMiles, 202)
  assert.equal(r.payAmount, 125.24)
  assert.equal(r.linehaulRevenue, null)
  assert.equal(r.unitNo, 'Demo - 15', "the driver's regular truck when the load names none")
  assert.equal(r.routeDetail, 'DUBUQUE, IA - CHICAGO, IL')
})

test('a mileage owner/operator is paid on total miles and shown the revenue', () => {
  const r = rules.routeFor(load({ unitNo: 'Demo - 21' }), mileage)
  assert.equal(r.payAmount, 379.76)
  assert.equal(r.linehaulRevenue, 530)
})

test('a percentage owner/operator is paid a share of the rate, not the miles', () => {
  const r = rules.routeFor(load(), percent)
  assert.equal(r.payAmount, 360.4)
  assert.equal(r.payRate, 0.68)
})

test('pennies are rounded per line, and the total is the sum of the lines', () => {
  const r = rules.routeFor(load({ miles: 333, emptyMiles: 0, rate: 1 }), { ...company, payRate: 0.615 })
  assert.equal(r.payAmount, 204.8)   // 333 * 0.615 = 204.795
})

test('a period must be in order and paid after it ends', () => {
  assert.deepEqual(rules.validatePeriod({ periodStart: '2026-09-06', periodEnd: '2026-09-12', checkDate: '2026-09-18' }), [])
  assert.deepEqual(rules.validatePeriod({ periodStart: '2026-09-13', periodEnd: '2026-09-12', checkDate: '2026-09-18' }),
    ['The period ends before it starts.'])
  assert.deepEqual(rules.validatePeriod({ periodStart: '2026-09-06', periodEnd: '2026-09-12', checkDate: '2026-09-10' }),
    ['The check date is before the period ends.'])
  assert.deepEqual(rules.validatePeriod({ periodStart: '9/6/2026', periodEnd: '', checkDate: '2026-02-30' }),
    ['Period start must be YYYY-MM-DD.', 'Period end must be YYYY-MM-DD.', 'Check date must be YYYY-MM-DD.'])
})

test('the default period is the last full Sunday-to-Saturday week, paid the Friday after', () => {
  assert.deepEqual(rules.defaultPeriod('2026-09-09'), { periodStart: '2026-08-30', periodEnd: '2026-09-05', checkDate: '2026-09-11' })
  // On a Sunday the week that just ended is the one.
  assert.deepEqual(rules.defaultPeriod('2026-09-06'), { periodStart: '2026-08-30', periodEnd: '2026-09-05', checkDate: '2026-09-11' })
  // On a Saturday the current week is not complete yet.
  assert.deepEqual(rules.defaultPeriod('2026-09-05'), { periodStart: '2026-08-23', periodEnd: '2026-08-29', checkDate: '2026-09-04' })
})

test('a plan groups loads by driver, carries stragglers, and flags conflicts', () => {
  const drivers = { JSMITH: company, MOKONKWO: percent }
  const loads = [
    load({ id: 'L-2', driverCode: 'JSMITH', deliveredDate: '2026-09-03' }),
    load({ id: 'L-1', driverCode: 'JSMITH', deliveredDate: '2026-08-20' }),   // before the period
    load({ id: 'L-3', driverCode: 'MOKONKWO', deliveredDate: '2026-09-04', rate: 1000 }),
    load({ id: 'L-9', driverCode: 'NOBODY' }),                              // no such driver
  ]
  const p = rules.plan(loads, drivers, {
    periodStart: '2026-08-30', periodEnd: '2026-09-05', checkDate: '2026-09-11', existing: new Set(['MOKONKWO']),
  })
  assert.equal(p.settlements.length, 2)
  const [smith, okonkwo] = [p.settlements.find((s) => s.driverCode === 'JSMITH'), p.settlements.find((s) => s.driverCode === 'MOKONKWO')]
  assert.deepEqual(smith.routes.map((r) => r.loadId), ['L-1', 'L-2'], 'oldest delivery first')
  assert.equal(smith.carriedOver, 1)
  assert.equal(smith.routes[0].carriedOver, true)
  assert.equal(smith.routePay, 250.48)
  assert.equal(smith.totalMiles, 404)
  assert.equal(okonkwo.conflict, true)
  assert.equal(okonkwo.routePay, 680)
  assert.deepEqual(p.totals, { drivers: 2, loads: 3, miles: 606, pay: 930.48, deductions: 0, net: 930.48, conflicts: 1 })
})

test('document numbers keep the CK-YYMMDD-NNNN shape', () => {
  assert.equal(rules.documentNo('2026-09-11', 1), 'CK-260911-0001')
  assert.equal(rules.documentNo('2026-09-11', 2013), 'CK-260911-2013')
})

test('a plan applies standing deductions after the routes and reports the net', () => {
  const drivers = { RVASQUEZ: mileage }
  const loads = [load({ id: 'L-5', driverCode: 'RVASQUEZ', deliveredDate: '2026-09-03', miles: 500, emptyMiles: 0, unitNo: 'Demo - 21' })]
  const deductions = {
    RVASQUEZ: [
      { deductionId: 1, code: 'TRUCKPAY', description: 'TRUCK PAYMENT', basis: 'FLAT', amount: 712, escrowCode: null, escrowOpening: null, balance: null, startDate: null, endDate: null, active: true },
      { deductionId: 2, code: 'FUEL', description: 'FUEL - COMCHEK', basis: 'PER_MILE', amount: 0.592, escrowCode: null, escrowOpening: null, balance: null, startDate: null, endDate: null, active: true },
      { deductionId: 3, code: 'MAINT', description: 'MAINTENANCE ESCROW', basis: 'FLAT', amount: 125, escrowCode: 'MAINT', escrowOpening: 2400, balance: null, startDate: null, endDate: null, active: true },
    ],
  }
  const p = rules.plan(loads, drivers, {
    periodStart: '2026-08-30', periodEnd: '2026-09-05', checkDate: '2026-09-11',
    deductions, escrowBalances: { RVASQUEZ: { MAINT: 2775 } },
  })
  const s = p.settlements[0]
  assert.equal(s.routePay, 940)                      // 500 x 1.88
  assert.deepEqual(s.lines.map((l) => [l.code, l.amount]), [['TRUCKPAY', -712], ['FUEL', -296], ['MAINT', -125]])
  assert.equal(s.deductionTotal, -1133)
  assert.equal(s.net, -193)
  assert.deepEqual(s.escrow, [{ code: 'MAINT', description: 'MAINTENANCE ESCROW', beginning: 2775, transaction: 125, current: 2900 }])
  assert.equal(p.totals.net, -193)
  assert.equal(p.totals.deductions, -1133)
})

test('a driver with no standing orders nets their route pay', () => {
  const p = rules.plan([load()], { JSMITH: company }, { periodStart: '2026-08-30', periodEnd: '2026-09-05', checkDate: '2026-09-11' })
  assert.equal(p.settlements[0].net, p.settlements[0].routePay)
  assert.deepEqual(p.settlements[0].lines, [])
})
