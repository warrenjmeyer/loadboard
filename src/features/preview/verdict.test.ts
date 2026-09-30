import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { makeVerdictFor, verdictUnavailable } from './verdict.ts'
import type { Roster } from '../get-me-home/contract.ts'
import type { ScheduleData, Stay } from '../home-time-schedule/contract.ts'

// The planner's verdict beside Approve: the join the host makes between the
// schedule and the planner, on the sample data -- and the same function the
// laptop-database preview gives the live roster.
const read = <T>(path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T
const roster = read<Roster>('../get-me-home/fixtures/roster.json')
const schedule = read<ScheduleData>('../home-time-schedule/fixtures/schedule.json')
const stay = (id: string) => {
  const found = schedule.stays.find((s) => s.id === id)
  if (!found) throw new Error(`no stay ${id}`)
  return found
}
const verdictFor = makeVerdictFor(roster, { now: roster.asOf })

test('each waiting request gets the planner\'s answer on that driver', () => {
  const terrell = verdictFor(stay('HT-1011'))
  assert.equal(terrell?.severity, 'error', 'Laredo on Monday morning is not Waterloo by Tuesday evening')
  assert.match(terrell?.text ?? '', /^The planner says this can't be made: earliest home /)
  assert.equal(verdictFor(stay('HT-1012'))?.severity, 'warning')
  assert.match(verdictFor(stay('HT-1012'))?.text ?? '', /^Can be made, only just: the trip home has to start by /)
  assert.equal(verdictFor(stay('HT-1013'))?.severity, 'warning', 'Dale makes it -- after a 34-hour restart')
})

test('an approved stay still gets one: the promise has to stay keepable', () => {
  assert.equal(verdictFor(stay('HT-1014'))?.severity, 'success')
  assert.match(verdictFor(stay('HT-1014'))?.text ?? '', /^Can be made, with .* to spare/)
})

test('a stay past deciding gets none', () => {
  for (const id of ['HT-1001', 'HT-1010', 'HT-1015', 'HT-1016']) assert.equal(verdictFor(stay(id)), null, id)
})

test('a driver the planner does not have is said so, not guessed at', () => {
  const stranger: Stay = { ...stay('HT-1011'), driverCode: 'NOBODY' }
  assert.equal(verdictFor(stranger)?.severity, 'info')
  assert.match(verdictFor(stranger)?.text ?? '', /no position or hours for this driver/)
})

test('when the roster cannot be had, every waiting request says why', () => {
  const unavailable = verdictUnavailable('no one is signed in.')
  assert.deepEqual(unavailable(stay('HT-1011')), { severity: 'info', text: 'The planner cannot say: no one is signed in.' })
  assert.equal(unavailable(stay('HT-1001')), null)
})
