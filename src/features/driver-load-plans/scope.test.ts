import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { scopeCandidates, scopeDriverPlan, scopeOpenLoads, scopePlanBoard } from './scope.ts'
import { boardWindow } from './rules.ts'
import { checkLoadPlans } from './contract.ts'
import type { LoadPlanData } from './contract.ts'

// What each read may return, and -- as much the point -- what it may not.
const all = JSON.parse(readFileSync(new URL('./fixtures/plans.json', import.meta.url), 'utf8')) as LoadPlanData
const w = boardWindow(all.asOf!)
const window = { from: new Date(w.start).toISOString(), to: new Date(w.end).toISOString() }
const codes = (d: LoadPlanData) => d.drivers.map((x) => x.driverCode).sort()
const ids = (d: LoadPlanData) => d.loads.map((l) => l.id).sort()

test('every scoped answer is itself valid load plan data', () => {
  for (const slice of [
    scopePlanBoard(all, window),
    scopeDriverPlan(all, 'RDELGADO'),
    scopeOpenLoads(all, window),
    scopeCandidates(all, 'L-30450'),
  ]) assert.deepEqual(checkLoadPlans(slice), [])
})

test('the board has every driver, and only planned loads in its week', () => {
  const b = scopePlanBoard(all, window)
  assert.equal(b.drivers.length, all.drivers.length)
  assert.ok(b.loads.every((l) => l.status === 'Covered' || l.status === 'In Transit'), 'no open, delivered or cancelled loads on the board')
  assert.deepEqual(ids(b), ['L-30412', 'L-30418', 'L-30421', 'L-30425', 'L-30430', 'L-30433', 'L-30440', 'L-30445'])
  assert.equal(b.stays.length, 2)
})

test('a driver\'s plan is theirs alone', () => {
  const d = scopeDriverPlan(all, 'RDELGADO')
  assert.deepEqual(codes(d), ['RDELGADO'])
  assert.deepEqual(d.loads.map((l) => l.id), ['L-30412', 'L-30418'], 'in plan order')
  assert.deepEqual(d.stays, [])
  assert.deepEqual(scopeDriverPlan(all, 'ACORTEZ').stays.map((s) => s.status), ['APPROVED'])
})

test('open loads are the Available ones picking up this week -- and no people', () => {
  const o = scopeOpenLoads(all, window)
  assert.deepEqual(ids(o), ['L-30450', 'L-30451', 'L-30452', 'L-30453', 'L-30454'])
  assert.ok(!ids(o).includes('L-30460'), 'Sioux City picks up on Oct 8, past the week')
  assert.deepEqual(o.drivers, [])
  assert.deepEqual(o.stays, [])
})

test('candidates for a load: that load first, every driver, and what they have planned', () => {
  const c = scopeCandidates(all, 'L-30450')
  assert.equal(c.loads[0]?.id, 'L-30450')
  assert.equal(c.drivers.length, all.drivers.length)
  assert.ok(c.loads.slice(1).every((l) => l.status === 'Covered' || l.status === 'In Transit'), 'no other open loads')
  assert.ok(!ids(c).includes('L-30451'))
  assert.deepEqual(scopeCandidates(all, 'L-99999'), { asOf: all.asOf, drivers: [], loads: [], stays: [] })
})

test('a load taken meanwhile still comes back, so the screen can say so', () => {
  const c = scopeCandidates(all, 'L-30418')
  assert.equal(c.loads[0]?.id, 'L-30418')
  assert.equal(c.loads[0]?.status, 'Covered')
})
