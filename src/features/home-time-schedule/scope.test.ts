import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { scopeBoard, scopeDriver, scopeQueue, scopeStay } from './scope.ts'
import { boardWindow } from './rules.ts'
import { checkSchedule } from './contract.ts'
import type { ScheduleData } from './contract.ts'

// What each read may return, and -- as much the point -- what it may not.
const all = JSON.parse(readFileSync(new URL('./fixtures/schedule.json', import.meta.url), 'utf8')) as ScheduleData
const codes = (d: ScheduleData) => d.drivers.map((x) => x.driverCode).sort()
const ids = (d: ScheduleData) => d.stays.map((s) => s.id).sort()

test('every scoped answer is itself valid schedule data', () => {
  const w = boardWindow(all.asOf!)
  for (const slice of [
    scopeQueue(all),
    scopeBoard(all, { from: new Date(w.start).toISOString(), to: new Date(w.end).toISOString() }),
    scopeDriver(all, 'TBOONE'),
    scopeStay(all, 'HT-1011'),
  ]) assert.deepEqual(checkSchedule(slice), [])
})

test('the queue is the three waiting requests and their three drivers -- nobody else', () => {
  const q = scopeQueue(all)
  assert.deepEqual(ids(q), ['HT-1011', 'HT-1012', 'HT-1013'])
  assert.deepEqual(codes(q), ['DFOSTER', 'HBARNETT', 'TBOONE'])
})

test('the board has every driver, but only the stays in its window', () => {
  const w = boardWindow(all.asOf!)
  const b = scopeBoard(all, { from: new Date(w.start).toISOString(), to: new Date(w.end).toISOString() })
  assert.equal(b.drivers.length, all.drivers.length)
  assert.ok(!ids(b).includes('HT-1001'), 'Terrell\'s stay in early September is outside the window')
  assert.ok(!ids(b).includes('HT-1015'), 'a declined stay never occupies the board')
  assert.ok(ids(b).includes('HT-1010'), 'Marcus, home now, is on it')
})

test('a scoped driver still knows their days out, from a stay the scope left out', () => {
  const w = boardWindow(all.asOf!)
  const b = scopeBoard(all, { from: new Date(w.start).toISOString(), to: new Date(w.end).toISOString() })
  // Terrell's last DONE stay (Sep 8-12) is not on the board, but his lastHomeAt is.
  assert.equal(b.drivers.find((d) => d.driverCode === 'TBOONE')?.lastHomeAt, '2026-09-12T13:00:00Z')
})

test('a driver\'s read is theirs alone', () => {
  const d = scopeDriver(all, 'TBOONE')
  assert.deepEqual(codes(d), ['TBOONE'])
  assert.deepEqual(ids(d), ['HT-1001', 'HT-1011'])
  assert.ok(d.stays.every((s) => s.driverCode === 'TBOONE'))
})

test('one stay is one stay and its driver; an unknown id is nothing', () => {
  const s = scopeStay(all, 'HT-1011')
  assert.deepEqual(ids(s), ['HT-1011'])
  assert.deepEqual(codes(s), ['TBOONE'])
  assert.deepEqual(scopeStay(all, 'HT-9999'), { asOf: all.asOf, drivers: [], stays: [] })
})
