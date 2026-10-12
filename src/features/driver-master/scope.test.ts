import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { allowed, scopeDriver, scopeDriverList } from './scope.ts'
import type { DriverRecord } from './contract.ts'

// ---------------------------------------------------------------------------
// What each read returns, and to whom: the list of what "the same" means for
// a server that answers these in SQL (src/features/sql/09_driver_reads.sql).
// ---------------------------------------------------------------------------
const all = (JSON.parse(readFileSync(new URL('./fixtures/drivers.json', import.meta.url), 'utf8')) as { drivers: DriverRecord[] }).drivers

test('who: dispatch and admin read; only admin adds and sees pay; anyone else nothing', () => {
  assert.deepEqual(allowed('admin'), { read: true, admin: true })
  assert.deepEqual(allowed('dispatch'), { read: true, admin: false })
  assert.deepEqual(allowed('other'), { read: false, admin: false })
})

test('loadDriverList: active drivers only, unless asked; sorted by last name', () => {
  const active = scopeDriverList(all, { includeInactive: false, caller: 'dispatch' })
  assert.equal(active.drivers.length, 10)
  assert.ok(!active.drivers.some((d) => d.driverCode === 'KMILLER'), 'a driver who has left is not on the everyday list')
  assert.deepEqual(active.drivers.slice(0, 3).map((d) => d.lastName), ['Barnett', 'Boone', 'Cortez'])
  const everyone = scopeDriverList(all, { includeInactive: true, caller: 'dispatch' })
  assert.equal(everyone.drivers.length, 11)
})

test('loadDriverList: a line per driver, nothing more -- whoever asks', () => {
  for (const caller of ['admin', 'dispatch'] as const) {
    for (const d of scopeDriverList(all, { includeInactive: true, caller }).drivers) {
      assert.ok(!('pay' in d) && !('address1' in d) && !('postalCode' in d), `${caller} received more than a line for ${d.driverCode}`)
    }
  }
})

test('loadDriverList says what the caller may do', () => {
  assert.deepEqual(scopeDriverList(all, { includeInactive: false, caller: 'admin' }).you, { canAdd: true, canSeePay: true })
  assert.deepEqual(scopeDriverList(all, { includeInactive: false, caller: 'dispatch' }).you, { canAdd: false, canSeePay: false })
})

test('loadDriver: one driver; pay for an admin, null for dispatch; nothing for an unknown code', () => {
  const asAdmin = scopeDriver(all, 'RVASQUEZ', { caller: 'admin' })
  assert.equal(asAdmin?.pay?.ssnLast4, '3308')
  const asDispatch = scopeDriver(all, 'RVASQUEZ', { caller: 'dispatch' })
  assert.equal(asDispatch?.pay, null)
  assert.equal(asDispatch?.address1, '418 Sycamore Street', 'dispatch still sees where they live')
  assert.equal(scopeDriver(all, 'NOBODY', { caller: 'admin' }), null)
  // A driver who has left can still be opened, to bring them back.
  assert.equal(scopeDriver(all, 'KMILLER', { caller: 'dispatch' })?.isActive, false)
})

test('withholding pay leaves the store alone', () => {
  scopeDriver(all, 'TBOONE', { caller: 'dispatch' })
  assert.ok(all.find((d) => d.driverCode === 'TBOONE')!.pay)
})
