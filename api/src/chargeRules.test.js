const test = require('node:test')
const assert = require('node:assert/strict')
const rules = require('./chargeRules')

const dispatcher = { role: 'dispatcher', driverCode: null }
const smith = { role: 'driver', driverCode: 'JSMITH' }
const oaks = { role: 'driver', driverCode: 'SOAKS' }
const load = { id: 'L-1', driverCode: 'JSMITH' }

test('a code decides the type and the words; the amount is rounded', () => {
  const { errors, charge } = rules.validateCharge({ code: 'tolls', amount: '12.505' })
  assert.deepEqual(errors, [])
  assert.deepEqual(charge, { code: 'TOLLS', lineType: 'REIMBURSEMENT', description: 'TOLLS', amount: 12.51, billCustomer: false, billAmount: null, receiptNote: null })
})

test('a typed description wins and is upper-cased like the seed', () => {
  const { charge } = rules.validateCharge({ code: 'DETENTION', description: 'Detention - 2 hrs', amount: 90 })
  assert.equal(charge.description, 'DETENTION - 2 HRS')
  assert.equal(charge.lineType, 'REVENUE')
})

test('OTHER needs a type and a description', () => {
  assert.deepEqual(rules.validateCharge({ code: 'OTHER', amount: 5 }).errors, [
    'Say whether this is extra pay (REVENUE) or money back (REIMBURSEMENT).',
    'Description is required.',
  ])
  const ok = rules.validateCharge({ code: 'OTHER', lineType: 'revenue', description: 'Tarp pay', amount: 50 })
  assert.deepEqual(ok.errors, [])
  assert.equal(ok.charge.lineType, 'REVENUE')
})

test('bad codes, amounts and bills are refused', () => {
  assert.ok(rules.validateCharge({ code: 'BRIBE', amount: 5 }).errors[0].startsWith('Code must be one of'))
  assert.deepEqual(rules.validateCharge({ code: 'TOLLS', amount: 0 }).errors, ['Amount must be above zero.'])
  assert.deepEqual(rules.validateCharge({ code: 'TOLLS', amount: 5, billAmount: -1 }).errors, ['Billed amount must be zero or more.'])
  const billed = rules.validateCharge({ code: 'LUMPER', amount: 125, billCustomer: true, billAmount: '125' })
  assert.equal(billed.charge.billCustomer, true)
  assert.equal(billed.charge.billAmount, 125)
})

test('dispatch adds anything; the driver on the load adds reimbursements only; others nothing', () => {
  const toll = { lineType: 'REIMBURSEMENT' }
  const detention = { lineType: 'REVENUE' }
  assert.equal(rules.canAdd(dispatcher, load, detention), true)
  assert.equal(rules.canAdd(smith, load, toll), true)
  assert.equal(rules.canAdd(smith, load, detention), false)
  assert.equal(rules.canAdd(oaks, load, toll), false)
  assert.equal(rules.canAdd(null, load, toll), false)
})

test('charges become positive lines placed on their load', () => {
  const lines = rules.linesFrom([
    { chargeId: 7, loadId: 'L-1', lineType: 'REVENUE', code: 'DETENTION', description: 'DETENTION - 2 HRS', amount: '90.00' },
    { chargeId: 8, loadId: 'L-1', lineType: 'REIMBURSEMENT', code: 'TOLLS', description: 'TOLLS', amount: 12.5 },
  ])
  assert.deepEqual(lines, [
    { type: 'REVENUE', orderNo: 'L-1', code: 'DETENTION', description: 'DETENTION - 2 HRS', amount: 90, chargeId: 7 },
    { type: 'REIMBURSEMENT', orderNo: 'L-1', code: 'TOLLS', description: 'TOLLS', amount: 12.5, chargeId: 8 },
  ])
})
