const test = require('node:test')
const assert = require('node:assert/strict')
const rules = require('./deductionRules')

const flat = (o = {}) => ({ deductionId: 1, code: 'TRUCKPAY', description: 'TRUCK PAYMENT', basis: 'FLAT', amount: 712, escrowCode: null, escrowOpening: null, balance: null, startDate: null, endDate: null, active: true, ...o })
const fuel = (o = {}) => flat({ deductionId: 2, code: 'FUEL', description: 'FUEL - COMCHEK', basis: 'PER_MILE', amount: 0.592, ...o })
const maint = (o = {}) => flat({ deductionId: 3, code: 'MAINT', description: 'MAINTENANCE ESCROW', amount: 125, escrowCode: 'MAINT', escrowOpening: 2400, ...o })
const advance = (o = {}) => flat({ deductionId: 4, code: 'ADV', description: 'ADVANCE', amount: 300, balance: 500, ...o })

test('a new deduction needs a code, a description and an amount; basis and active default', () => {
  const { errors, fields } = rules.validateDeduction({ code: 'truckpay', description: 'Truck payment', amount: '712' })
  assert.deepEqual(errors, [])
  assert.equal(fields.code, 'TRUCKPAY')
  assert.equal(fields.basis, 'FLAT')
  assert.equal(fields.active, true)
  assert.equal(fields.amount, 712)
  assert.deepEqual(rules.validateDeduction({}).errors, ['Code is required.', 'Description is required.', 'Amount is required.'])
  assert.deepEqual(rules.validateDeduction({ code: 'X', description: 'x', amount: 0 }).errors, ['Amount must be above zero.'])
})

test('a per-mile rate keeps four decimals; an escrow row cannot be per-mile or a loan', () => {
  assert.equal(rules.validateDeduction({ code: 'FUEL', description: 'x', basis: 'PER_MILE', amount: '0.5920' }).fields.amount, 0.592)
  assert.deepEqual(rules.validateDeduction({ code: 'M', description: 'x', basis: 'PER_MILE', amount: 1, escrowCode: 'MAINT' }).errors,
    ['An escrow contribution must be a flat amount.'])
  assert.deepEqual(rules.validateDeduction({ code: 'M', description: 'x', amount: 1, escrowCode: 'MAINT', balance: 100 }).errors,
    ['An escrow contribution cannot also be a loan.'])
})

test('isDue honours active, the date window, and a paid-off loan', () => {
  assert.equal(rules.isDue(flat(), '2026-09-11'), true)
  assert.equal(rules.isDue(flat({ active: false }), '2026-09-11'), false)
  assert.equal(rules.isDue(flat({ startDate: '2026-09-18' }), '2026-09-11'), false)
  assert.equal(rules.isDue(flat({ endDate: '2026-09-04' }), '2026-09-11'), false)
  assert.equal(rules.isDue(flat({ startDate: '2026-09-11', endDate: '2026-09-11' }), '2026-09-11'), true)
  assert.equal(rules.isDue(advance({ balance: 0 }), '2026-09-11'), false)
})

test('flat and per-mile lines come out negative and total correctly', () => {
  const r = rules.linesFor([flat(), fuel()], { totalMiles: 1000, checkDate: '2026-09-11' })
  assert.deepEqual(r.lines.map((l) => [l.code, l.amount]), [['TRUCKPAY', -712], ['FUEL', -592]])
  assert.equal(r.deductionTotal, -1304)
  assert.deepEqual(r.escrow, [])
  assert.deepEqual(r.balanceUpdates, [])
})

test('an escrow contribution is deducted and moves the balance from the last statement', () => {
  const r = rules.linesFor([maint()], { totalMiles: 500, escrowBalances: { MAINT: 2775 }, checkDate: '2026-09-11' })
  assert.deepEqual(r.lines.map((l) => [l.code, l.amount, l.escrowCode]), [['MAINT', -125, 'MAINT']])
  assert.deepEqual(r.escrow, [{ code: 'MAINT', description: 'MAINTENANCE ESCROW', beginning: 2775, transaction: 125, current: 2900 }])
})

test('an escrow contribution with no statement yet starts from the opening balance', () => {
  const r = rules.linesFor([maint()], { totalMiles: 500, checkDate: '2026-09-11' })
  assert.deepEqual(r.escrow[0], { code: 'MAINT', description: 'MAINTENANCE ESCROW', beginning: 2400, transaction: 125, current: 2525 })
})

test('a loan takes its amount until the last week, which takes what is left', () => {
  const first = rules.linesFor([advance()], { totalMiles: 0, checkDate: '2026-09-11' })
  assert.equal(first.lines[0].amount, -300)
  assert.deepEqual(first.balanceUpdates, [{ deductionId: 4, balance: 200 }])

  const last = rules.linesFor([advance({ balance: 200 })], { totalMiles: 0, checkDate: '2026-09-18' })
  assert.equal(last.lines[0].amount, -200)
  assert.deepEqual(last.balanceUpdates, [{ deductionId: 4, balance: 0 }])

  const done = rules.linesFor([advance({ balance: 0 })], { totalMiles: 0, checkDate: '2026-09-25' })
  assert.deepEqual(done.lines, [])
})

test('pennies on a per-mile line are rounded once', () => {
  const r = rules.linesFor([fuel({ amount: 0.5925 })], { totalMiles: 333, checkDate: '2026-09-11' })
  assert.equal(r.lines[0].amount, -197.3)   // 197.3025
})
