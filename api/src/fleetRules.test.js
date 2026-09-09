const test = require('node:test')
const assert = require('node:assert/strict')
const rules = require('./fleetRules')

test('a new company truck needs only a description', () => {
  const { errors, fields } = rules.validateTruck({ description: ' 2021 Freightliner Cascadia ' })
  assert.deepEqual(errors, [])
  assert.equal(fields.description, '2021 Freightliner Cascadia')
  assert.equal(fields.status, 'Active')
  assert.equal(fields.ownerType, 'COMPANY')
  assert.equal(fields.ownerDriverCode, null)
  assert.equal(fields.vin, null)
})

test('an owner/operator truck must name its owner, and a company truck must not', () => {
  assert.deepEqual(
    rules.validateTruck({ description: 'x', ownerType: 'OWNER' }).errors,
    ['An owner/operator truck must name its owner.']
  )
  assert.deepEqual(
    rules.validateTruck({ description: 'x', ownerType: 'COMPANY', ownerDriverCode: 'rvasquez' }).errors,
    ['A company truck has no owner driver.']
  )
  const ok = rules.validateTruck({ description: 'x', ownerType: 'OWNER', ownerDriverCode: 'rvasquez' })
  assert.deepEqual(ok.errors, [])
  assert.equal(ok.fields.ownerDriverCode, 'RVASQUEZ')
})

test('plates, states and VINs are normalised or refused', () => {
  const { errors, fields } = rules.validateTruck({
    description: 'x', plate: 'ml 4471', plateState: 'ia', vin: '1fujgldr5clbx1234',
  })
  assert.deepEqual(errors, [])
  assert.equal(fields.plate, 'ML 4471')
  assert.equal(fields.plateState, 'IA')
  assert.equal(fields.vin, '1FUJGLDR5CLBX1234')

  const bad = rules.validateTruck({ description: 'x', vin: '1FUJGLDR5CLBO1234', plateState: 'Iowa' })
  assert.ok(bad.errors.some((e) => e.startsWith('VIN')))
  assert.ok(bad.errors.some((e) => e.startsWith('Plate state')))
})

test('dates and years are checked', () => {
  const bad = rules.validateTruck({ description: 'x', registrationExpires: '3/31/2027', modelYear: 1950 })
  assert.deepEqual(bad.errors, [
    'Year must be between 1980 and 2100.',
    'Registration expires must be YYYY-MM-DD.',
  ])
})

test('a partial truck validation touches only what was sent', () => {
  const { errors, fields } = rules.validateTruck({ status: 'Shop' }, { partial: true })
  assert.deepEqual(errors, [])
  assert.deepEqual(fields, { status: 'Shop' })
  assert.deepEqual(rules.validateTruck({ status: 'Broken' }, { partial: true }).errors,
    ['Status must be one of: Active, Shop, Retired.'])
})

test('a trailer needs a type from the equipment list', () => {
  assert.deepEqual(rules.validateTrailer({}).errors, ['Type is required.'])
  assert.deepEqual(rules.validateTrailer({ trailerType: 'Tanker' }).errors,
    ['Type must be one of: Dry Van, Reefer, Flatbed.'])
  const ok = rules.validateTrailer({ trailerType: 'Reefer', description: "53' Utility 3000R" })
  assert.deepEqual(ok.errors, [])
  assert.equal(ok.fields.status, 'Active')
})

test('unit numbers accept what MyGeotab and the settlements use', () => {
  assert.equal(rules.validateUnitNo('Demo - 01').value, 'Demo - 01')
  assert.equal(rules.validateUnitNo(' T-101 ').value, 'T-101')
  assert.equal(rules.validateUnitNo('1542').value, '1542')
  assert.ok(rules.validateUnitNo('').error)
  assert.ok(rules.validateUnitNo('-lead').error)
  assert.ok(rules.validateUnitNo('x'.repeat(21)).error)
  assert.ok(rules.validateUnitNo("T'101").error)
})

test('daysUntil counts from the given today, and is negative once passed', () => {
  assert.equal(rules.daysUntil('2026-09-30', '2026-09-09'), 21)
  assert.equal(rules.daysUntil('2026-09-09', '2026-09-09'), 0)
  assert.equal(rules.daysUntil('2026-03-31', '2026-09-09'), -162)
  assert.equal(rules.daysUntil(null, '2026-09-09'), null)
})
