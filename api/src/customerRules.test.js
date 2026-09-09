const test = require('node:test')
const assert = require('node:assert/strict')
const rules = require('./customerRules')

test('a new customer needs only a name; type, status and terms default', () => {
  const { errors, fields } = rules.validateCustomer({ name: ' Prairie Freight Partners ' })
  assert.deepEqual(errors, [])
  assert.equal(fields.name, 'Prairie Freight Partners')
  assert.equal(fields.customerType, 'Broker')
  assert.equal(fields.status, 'Active')
  assert.equal(fields.paymentTermsDays, 30)
  assert.equal(fields.creditLimit, null)
})

test('MC numbers are normalised to MC-digits', () => {
  assert.equal(rules.validateCustomer({ name: 'x', mcNumber: '771204' }).fields.mcNumber, 'MC-771204')
  assert.equal(rules.validateCustomer({ name: 'x', mcNumber: 'mc771204' }).fields.mcNumber, 'MC-771204')
  assert.equal(rules.validateCustomer({ name: 'x', mcNumber: 'MC-771204' }).fields.mcNumber, 'MC-771204')
  assert.ok(rules.validateCustomer({ name: 'x', mcNumber: 'MC-12' }).errors[0].startsWith('MC number'))
})

test('email, state, terms and credit are checked', () => {
  const bad = rules.validateCustomer({ name: 'x', email: 'nope', state: 'Iowa', paymentTermsDays: 400, creditLimit: -5 })
  assert.deepEqual(bad.errors, [
    'State must be two letters.',
    'Email does not look like an address.',
    'Payment terms must be between 0 and 180.',
    'Credit limit must be zero or more.',
  ])
  const ok = rules.validateCustomer({ name: 'x', email: 'AP@Example.COM', state: 'ia', creditLimit: '25000.005' })
  assert.deepEqual(ok.errors, [])
  assert.equal(ok.fields.email, 'ap@example.com')
  assert.equal(ok.fields.state, 'IA')
  assert.equal(ok.fields.creditLimit, 25000.01)
})

test('a partial validation touches only what was sent and refuses to blank the name', () => {
  assert.deepEqual(rules.validateCustomer({ status: 'Hold' }, { partial: true }), { errors: [], fields: { status: 'Hold' } })
  assert.deepEqual(rules.validateCustomer({ name: '' }, { partial: true }).errors, ['Name is required.'])
  assert.deepEqual(rules.validateCustomer({ status: 'Banned' }, { partial: true }).errors,
    ['Status must be one of: Active, Hold, Inactive.'])
})

test('only an active customer, or no customer, is coverable', () => {
  assert.equal(rules.coverable('Active'), true)
  assert.equal(rules.coverable(null), true)
  assert.equal(rules.coverable(undefined), true)
  assert.equal(rules.coverable('Hold'), false)
  assert.equal(rules.coverable('Inactive'), false)
})
