import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  applyActive, applyChanges, blankNewDriver, changesBetween, checkDetails, checkNewDriver, checkPay, describePay, homeTimeRule,
  matchesSearch, normalizeDetails, suggestCode, summaryOf, PAY_IS_ADMINS, STALE_MESSAGE,
} from './rules.ts'
import { checkDriverList, checkDriverRecord } from './contract.ts'
import type { DriverPay, DriverRecord } from './contract.ts'

type Stored = DriverRecord & { pay: DriverPay }
const sample = JSON.parse(readFileSync(new URL('./fixtures/drivers.json', import.meta.url), 'utf8')) as { drivers: Stored[] }
const boone = () => structuredClone(sample.drivers.find((d) => d.driverCode === 'TBOONE')!)
const vasquez = () => structuredClone(sample.drivers.find((d) => d.driverCode === 'RVASQUEZ')!)

test('the sample drivers are all fit to store, and are what loadDriver answers', () => {
  for (const d of sample.drivers) {
    assert.deepEqual(checkDetails(d), {}, d.driverCode)
    assert.deepEqual(checkPay(d.pay, d.driverType), {}, d.driverCode)
    assert.deepEqual(checkDriverRecord(d), [], d.driverCode)
  }
})

test('details: what is needed, what fits, and a US address', () => {
  const d = boone()
  assert.deepEqual(checkDetails({ ...d, firstName: '  ', city: '' }), {
    firstName: 'First name is needed.',
    city: 'City is needed.',
  })
  assert.match(checkDetails({ ...d, address1: 'x'.repeat(101) }).address1!, /101 characters; it can be 100 at most/)
  assert.match(checkDetails({ ...d, state: 'XX' }).state!, /XX is not a US state/)
  assert.equal(checkDetails({ ...d, state: 'ia' }).state, undefined, 'a state in lower case is put in capitals, not refused')
  assert.match(checkDetails({ ...d, postalCode: '5070' }).postalCode!, /five digits/)
  assert.equal(checkDetails({ ...d, postalCode: '50703-1234' }).postalCode, undefined)
  // Outside the USA, a province and a postcode are whatever they are.
  assert.deepEqual(checkDetails({ ...d, country: 'Canada', state: 'ON', postalCode: 'K1A 0B1' }), {})
  // The optional ones may be empty.
  assert.deepEqual(checkDetails({ ...d, address2: null, unitNo: '', truckDescription: null }), {})
})

test('normalizing: spaces, capitals, empties', () => {
  const n = normalizeDetails({ ...boone(), firstName: '  Terrell  ', city: 'Water   loo', state: 'ia', address2: '   ', unitNo: '' })
  assert.equal(n.firstName, 'Terrell')
  assert.equal(n.city, 'Water loo')
  assert.equal(n.state, 'IA')
  assert.equal(n.address2, null)
  assert.equal(n.unitNo, null)
})

test('pay: an owner has a basis, a company driver none -- the load board\'s CK_Drivers_paybasis', () => {
  const company = boone().pay
  assert.deepEqual(checkPay(company, 'COMPANY'), {})
  assert.match(checkPay({ ...company, payBasis: 'MILEAGE' }, 'COMPANY').payBasis!, /company driver has no pay basis/)
  assert.match(checkPay({ ...company, payBasis: null }, 'OWNER').payBasis!, /by the mile or by a share/)
})

test('pay: the SSN is four digits, the rate a number that fits', () => {
  const p = boone().pay
  assert.match(checkPay({ ...p, ssnLast4: '123' }, 'COMPANY').ssnLast4!, /four digits/)
  assert.match(checkPay({ ...p, ssnLast4: '123-45-6789' }, 'COMPANY').ssnLast4!, /four digits/)
  assert.match(checkPay({ ...p, payRate: Number.NaN }, 'COMPANY').payRate!, /needed/)
  assert.match(checkPay({ ...p, payRate: -1 }, 'COMPANY').payRate!, /below zero/)
  assert.match(checkPay({ ...p, payRate: 0.12345 }, 'COMPANY').payRate!, /four decimal places/)
  assert.equal(checkPay({ ...p, payRate: 0.6215 }, 'COMPANY').payRate, undefined)
  // A share of the linehaul is a fraction -- 68, typed for 68%, is caught.
  const share = vasquez().pay
  assert.match(checkPay({ ...share, payRate: 68 }, 'OWNER').payRate!, /0\.68 for 68%/)
  assert.match(checkPay({ ...p, payGroup: ' ' }, 'COMPANY').payGroup!, /needed/)
})

test('a new driver: a code in the house style, never reused', () => {
  const taken = sample.drivers.map((d) => d.driverCode)
  const n = { ...blankNewDriver(), firstName: 'Ana', lastName: 'Ruiz', address1: '1 Main St', city: 'Ames', state: 'IA', postalCode: '50010',
    job: 'OTR Driver', jobType: 'Company Driver', location: 'Ames, IA', department: 'Linehaul',
    pay: { ssnLast4: '1234', payRate: 0.6, payFrequency: 'W' as const, payBasis: null, payGroup: 'HMLOTR' } }
  assert.deepEqual(checkNewDriver({ ...n, driverCode: 'ARUIZ' }, taken), {})
  assert.deepEqual(checkNewDriver({ ...n, driverCode: 'aruiz' }, taken), {}, 'typed in lower case, stored in upper')
  assert.match(checkNewDriver({ ...n, driverCode: 'TBOONE' }, taken).driverCode!, /TBOONE is taken/)
  // KMILLER has left; the code is still his.
  assert.match(checkNewDriver({ ...n, driverCode: 'KMILLER' }, taken).driverCode!, /never reused/)
  assert.match(checkNewDriver({ ...n, driverCode: 'A-RUIZ' }, taken).driverCode!, /letters and digits/)
  assert.match(checkNewDriver({ ...n, driverCode: '' }, taken).driverCode!, /needed/)
})

test('suggestCode: first initial and last name, numbered when taken', () => {
  assert.equal(suggestCode('Terrell', 'Boone', []), 'TBOONE')
  assert.equal(suggestCode('Terrell', 'Boone', ['TBOONE']), 'TBOONE2')
  assert.equal(suggestCode('Tia', 'Boone', ['TBOONE', 'TBOONE2']), 'TBOONE3')
  assert.equal(suggestCode('José', "O'Brien-Núñez", []), 'JOBRIENNUNEZ')
  assert.equal(suggestCode('Ana', '', []), '', 'nothing to make one from yet')
  assert.equal(suggestCode('A', 'Abcdefghijklmnopqrstuvwxyz', []).length, 20)
  assert.equal(suggestCode('A', 'Abcdefghijklmnopqrstuvwxyz', ['AABCDEFGHIJKLMNOPQRS']), 'AABCDEFGHIJKLMNOPQR2')
})

test('changesBetween: only what changed, and pay only from a form that had it', () => {
  const r = boone()
  const details = { ...r, city: 'Cedar Falls', postalCode: '50613' }
  assert.deepEqual(changesBetween(r, { details, driverType: r.driverType, pay: r.pay }), { city: 'Cedar Falls', postalCode: '50613' })
  // Spaces and case that normalize away are no change.
  assert.deepEqual(changesBetween(r, { details: { ...r, firstName: ' Terrell ', state: 'ia' }, driverType: r.driverType, pay: r.pay }), {})
  assert.deepEqual(changesBetween(r, { details: r, driverType: r.driverType, pay: { ...r.pay, payRate: 0.65 } }), { pay: { payRate: 0.65 } })
  assert.deepEqual(changesBetween(r, { details: r, driverType: 'OWNER', pay: { ...r.pay, payBasis: 'MILEAGE' } }), { driverType: 'OWNER', pay: { payBasis: 'MILEAGE' } })
  // Dispatch's record has no pay, so whatever the form holds, none is sent.
  const dispatch = { ...r, pay: null }
  assert.deepEqual(changesBetween(dispatch, { details: r, driverType: 'OWNER', pay: null }), {})
})

test('applyChanges: on the version read, by someone allowed, leaving a driver fit to store', () => {
  const r = boone()
  const moved = applyChanges(r, '1', { city: 'Cedar Falls', postalCode: '50613' }, { canChangePay: false })
  assert.ok('record' in moved)
  assert.equal(moved.record.city, 'Cedar Falls')
  assert.equal(moved.record.pay.payRate, 0.62, 'pay untouched')

  assert.deepEqual(applyChanges(r, '0', { city: 'Cedar Falls' }, { canChangePay: true }), { error: STALE_MESSAGE('TBOONE') })
  assert.deepEqual(applyChanges(r, '1', { pay: { payRate: 9 } }, { canChangePay: false }), { error: PAY_IS_ADMINS })
  assert.deepEqual(applyChanges(r, '1', { driverType: 'OWNER' }, { canChangePay: false }), { error: PAY_IS_ADMINS })
  // An admin turning a company driver into an owner must say how they are paid.
  const owner = applyChanges(r, '1', { driverType: 'OWNER' }, { canChangePay: true })
  assert.ok('error' in owner && /by the mile or by a share/.test(owner.error))
  const paid = applyChanges(r, '1', { driverType: 'OWNER', pay: { payBasis: 'MILEAGE', payRate: 1.7 } }, { canChangePay: true })
  assert.ok('record' in paid && paid.record.driverType === 'OWNER' && paid.record.pay.payRate === 1.7)
  // What is not a field cannot ride along.
  const sneaky = applyChanges(r, '1', { driverCode: 'XBOONE' } as never, { canChangePay: true })
  assert.ok('error' in sneaky && /driverCode cannot be changed/.test(sneaky.error))
  const broken = applyChanges(r, '1', { state: 'XX' }, { canChangePay: true })
  assert.ok('error' in broken && /not a US state/.test(broken.error))
})

test('applyActive: leaving and coming back, on the version read', () => {
  const r = boone()
  const left = applyActive(r, '1', false)
  assert.ok('record' in left && left.record.isActive === false)
  assert.deepEqual(applyActive(r, '2', false), { error: STALE_MESSAGE('TBOONE') })
})

test('search: every word, anywhere in the line', () => {
  const s = summaryOf(boone())
  assert.ok(matchesSearch(s, ''))
  assert.ok(matchesSearch(s, 'boone'))
  assert.ok(matchesSearch(s, 'waterloo terrell'))
  assert.ok(matchesSearch(s, 'demo - 02'))
  assert.ok(!matchesSearch(s, 'boone dubuque'))
})

test('summaryOf carries nothing a list must not', () => {
  const s = summaryOf(boone())
  assert.deepEqual(checkDriverList({ drivers: [s], you: { canAdd: false, canSeePay: false } }), [])
  assert.deepEqual(Object.keys(s).sort(), ['city', 'driverCode', 'driverType', 'firstName', 'hasLogin', 'isActive', 'job', 'lastName', 'state', 'unitNo'])
})

test('checkDriverList refuses a list that has been widened', () => {
  const widened = { ...summaryOf(boone()), address1: '1214 Lafayette Street', pay: boone().pay }
  const problems = checkDriverList({ drivers: [widened], you: { canAdd: true, canSeePay: true } })
  assert.ok(problems.some((p) => /carries address1/.test(p)))
  assert.ok(problems.some((p) => /carries pay/.test(p)))
})

test('checkDriverRecord: pay must be there, as null when withheld', () => {
  const { pay: _pay, ...noPay } = boone()
  assert.ok(checkDriverRecord(noPay).some((p) => /pay must be there/.test(p)))
  assert.deepEqual(checkDriverRecord({ ...boone(), pay: null }), [])
})

test('describePay and homeTimeRule', () => {
  assert.equal(describePay(boone().pay), '$0.6200 a mile, weekly')
  assert.equal(describePay(vasquez().pay), '68% of the linehaul, weekly')
  assert.equal(homeTimeRule('OTR Driver'), 'OTR')
  assert.equal(homeTimeRule('Dedicated Owner Operator'), 'Dedicated')
  assert.equal(homeTimeRule('Owner Operator'), null)
})
