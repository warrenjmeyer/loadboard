import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  actionsFor, applyAction, barFor, boardWindow, checkNewStay, detectHomeMoves, homeCounts, homeTimeFor, needsDecision, positionOf,
} from './rules.ts'
import type { Fix } from './rules.ts'
import { checkSchedule } from './contract.ts'
import type { ScheduleData, Stay, StayStatus } from './contract.ts'

const data = JSON.parse(readFileSync(new URL('./fixtures/schedule.json', import.meta.url), 'utf8')) as ScheduleData
const NOW = '2026-09-28T15:00:00Z'

function must<T>(value: T | null | undefined, what = 'a value'): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`)
  return value
}
const stay = (id: string) => must(data.stays.find((s) => s.id === id), id)

// A stay built from parts, so each test says only what it is about.
function make(overrides: Partial<Stay> = {}): Stay {
  return {
    id: 'T-1', driverCode: 'TEST', status: 'REQUESTED',
    homeBy: '2026-10-02T23:00:00Z', backOut: '2026-10-05T11:00:00Z', note: null,
    requestedAt: '2026-09-27T12:00:00Z', decidedAt: null, decidedBy: null, declineReason: null,
    arrivedAt: null, leftAt: null,
    ...overrides,
  }
}
const statusOf = (r: { stay: Stay } | { error: string }): StayStatus | string => ('stay' in r ? r.stay.status : r.error)

test('the sample schedule matches the contract', () => {
  assert.deepEqual(checkSchedule(data), [])
})

test('each status offers only the moves it allows', () => {
  assert.deepEqual(actionsFor('REQUESTED'), ['approve', 'decline', 'cancel'])
  assert.deepEqual(actionsFor('APPROVED'), ['cancel', 'arrive'])
  assert.deepEqual(actionsFor('HOME'), ['leave', 'correct'])
  assert.deepEqual(actionsFor('DONE'), ['correct'])
  assert.deepEqual(actionsFor('DECLINED'), [])
  assert.deepEqual(actionsFor('CANCELLED'), [])
})

test('a request goes approved, home, done -- and records who and when', () => {
  const approved = applyAction(make(), { type: 'approve' }, { now: NOW, by: 'Dana' })
  assert.ok('stay' in approved)
  assert.equal(approved.stay.status, 'APPROVED')
  assert.equal(approved.stay.decidedBy, 'Dana')
  assert.equal(approved.stay.decidedAt, NOW)

  const home = applyAction(approved.stay, { type: 'arrive', at: '2026-10-02T22:30:00Z' }, { now: NOW, by: null })
  assert.ok('stay' in home)
  assert.equal(home.stay.arrivedAt, '2026-10-02T22:30:00Z')

  const done = applyAction(home.stay, { type: 'leave', at: '2026-10-05T12:00:00Z' }, { now: NOW, by: null })
  assert.ok('stay' in done)
  assert.equal(done.stay.status, 'DONE')
  assert.equal(done.stay.leftAt, '2026-10-05T12:00:00Z')
})

test('a move the status does not allow is refused, and the stay is untouched', () => {
  const s = make({ status: 'DONE', arrivedAt: '2026-10-02T22:30:00Z', leftAt: '2026-10-05T12:00:00Z' })
  assert.match(statusOf(applyAction(s, { type: 'approve' }, { now: NOW, by: 'Dana' })), /done stay cannot be approved/)
  assert.equal(s.status, 'DONE')
})

test('a decline needs a reason', () => {
  assert.match(statusOf(applyAction(make(), { type: 'decline', reason: '   ' }, { now: NOW, by: 'Dana' })), /owed a reason/)
  const r = applyAction(make(), { type: 'decline', reason: ' Short-handed that week. ' }, { now: NOW, by: 'Dana' })
  assert.ok('stay' in r)
  assert.equal(r.stay.declineReason, 'Short-handed that week.')
})

test('leaving before arriving is refused', () => {
  const home = make({ status: 'HOME', arrivedAt: '2026-10-02T22:30:00Z' })
  assert.match(statusOf(applyAction(home, { type: 'leave', at: '2026-10-01T00:00:00Z' }, { now: NOW, by: null })), /before arriving/)
})

test('a new request must be in the future, in order, and not on top of another', () => {
  const ask = (homeBy: string, backOut: string) => checkNewStay({ driverCode: 'TBOONE', homeBy, backOut, note: null }, data.stays, { now: NOW })
  assert.match(ask('2026-09-27T12:00:00Z', '2026-09-30T12:00:00Z').join(), /has to be in the future/)
  assert.match(ask('2026-10-10T12:00:00Z', '2026-10-09T12:00:00Z').join(), /has to be after/)
  // Terrell already asked for Sep 29 - Oct 4.
  assert.match(ask('2026-10-01T12:00:00Z', '2026-10-06T12:00:00Z').join(), /overlaps a stay you already have \(requested\)/)
  assert.deepEqual(ask('2026-10-10T12:00:00Z', '2026-10-12T12:00:00Z'), [])
})

test('what the planner needs: last home, and the earliest open request', () => {
  // Terrell: last left home on Sep 12; asked to be home by Tuesday 6 PM.
  assert.deepEqual(homeTimeFor(data.stays, 'TBOONE', NOW), {
    lastHomeAt: '2026-09-12T13:00:00Z', requestedBy: '2026-09-29T18:00:00-05:00', note: "Son's homecoming game Tuesday night",
  })
  // Rosa: her request was declined, so she has no open one.
  assert.equal(homeTimeFor(data.stays, 'RDELGADO', NOW).requestedBy, null)
  // Marcus is at home right now: out zero days, whatever he did before.
  assert.equal(homeTimeFor(data.stays, 'MWEBB', NOW).lastHomeAt, NOW)
  // Nobody at all: nothing known.
  assert.deepEqual(homeTimeFor(data.stays, 'NOBODY', NOW), { lastHomeAt: null, requestedBy: null, note: null })
})

test('requests waiting on a decision come oldest first', () => {
  assert.deepEqual(needsDecision(data.stays).map((s) => s.id), ['HT-1011', 'HT-1013', 'HT-1012'])
})

test('the board is fourteen whole days, starting three days back, around now', () => {
  const w = boardWindow(NOW)
  assert.equal(w.days.length, 14)
  const now = Date.parse(NOW)
  assert.ok(w.start < now && now < w.end)
  // Now falls on the fourth day.
  assert.ok(w.days[3]!.start <= now && now < w.days[3]!.end)
  // Contiguous: each day starts where the last one ended.
  for (let i = 1; i < w.days.length; i += 1) assert.equal(w.days[i]!.start, w.days[i - 1]!.end)
  const pos = must(positionOf(NOW, w))
  assert.ok(pos > 3 / 14 && pos < 4 / 14, `now at ${pos}`)
})

test('a bar sits where the stay does, and is cut at the window\'s edge', () => {
  const w = boardWindow(NOW)
  // Priya's stay began before the window: clipped at the start.
  const priya = must(barFor(stay('HT-1008'), w))
  assert.equal(priya.left, 0)
  assert.equal(priya.clippedStart, true)
  // Terrell's request sits inside it.
  const terrell = must(barFor(stay('HT-1011'), w))
  assert.ok(terrell.left > 0 && terrell.left + terrell.width < 1)
  // Declined and long-finished stays are not on the board.
  assert.equal(barFor(stay('HT-1015'), w), null)
  assert.equal(barFor(stay('HT-1001'), w), null)
})

test('the daily count is approved, home or done -- not merely requested', () => {
  const w = boardWindow(NOW)
  const counts = homeCounts(data.stays, w)
  assert.equal(counts.length, 14)
  // Today (day 4): Marcus is home, and Sherman was home last night.
  assert.equal(counts[3], 2)
  // Terrell's request on Sep 30 does not count until it is approved.
  const approvedTerrell = data.stays.map((s) => (s.id === 'HT-1011' ? { ...s, status: 'APPROVED' as const } : s))
  assert.equal(homeCounts(approvedTerrell, w)[5]! - counts[5]!, 1)
})

// ---------------------------------------------------------------------------
// Who recorded an arrival, and dispatch correcting it.
// ---------------------------------------------------------------------------
test('an arrival or departure records who saw it', () => {
  const approved = make({ status: 'APPROVED', decidedAt: '2026-09-27T12:00:00Z' })
  const byGeotab = applyAction(approved, { type: 'arrive', at: '2026-09-28T01:00:00Z' }, { now: NOW, by: null, source: 'GEOTAB' })
  assert.ok('stay' in byGeotab)
  assert.equal(byGeotab.stay.arrivedSource, 'GEOTAB')
  const byHand = applyAction(approved, { type: 'arrive' }, { now: NOW, by: 'Dana' })
  assert.ok('stay' in byHand)
  assert.equal(byHand.stay.arrivedSource, 'DISPATCH', 'clicking is dispatch, unless told otherwise')
})

test('dispatch corrects what GeoTab recorded, and the status stays put', () => {
  const home = make({ status: 'HOME', arrivedAt: '2026-09-27T23:40:00Z', arrivedSource: 'GEOTAB' })
  const fixed = applyAction(home, { type: 'correct', arrivedAt: '2026-09-27T22:55:00Z' }, { now: NOW, by: 'Dana' })
  assert.ok('stay' in fixed)
  assert.equal(fixed.stay.status, 'HOME')
  assert.equal(fixed.stay.arrivedAt, '2026-09-27T22:55:00Z')
  assert.equal(fixed.stay.arrivedSource, 'DISPATCH')
})

test('a correction cannot invent a departure, reach into the future, or leave before arriving', () => {
  const home = make({ status: 'HOME', arrivedAt: '2026-09-27T23:40:00Z' })
  assert.match(statusOf(applyAction(home, { type: 'correct', leftAt: '2026-09-28T09:00:00Z' }, { now: NOW, by: 'Dana' })), /not left yet/)
  assert.match(statusOf(applyAction(home, { type: 'correct', arrivedAt: '2026-09-29T09:00:00Z' }, { now: NOW, by: 'Dana' })), /not happened yet/)
  const done = make({ status: 'DONE', arrivedAt: '2026-09-25T23:40:00Z', leftAt: '2026-09-27T12:00:00Z' })
  assert.match(statusOf(applyAction(done, { type: 'correct', leftAt: '2026-09-25T20:00:00Z' }, { now: NOW, by: 'Dana' })), /before arriving/)
  assert.match(statusOf(applyAction(make(), { type: 'correct', arrivedAt: NOW }, { now: NOW, by: 'Dana' })), /no arrival or departure to correct/)
})

// ---------------------------------------------------------------------------
// GeoTab marking arrivals and departures. A made-up track for a made-up
// driver who lives in Cedar Rapids: fixes every half hour or so, on a clock
// that starts on Saturday evening.
// ---------------------------------------------------------------------------
const HOME = { driverCode: 'TEST', latitude: 41.9779, longitude: -91.6656 }
const IOWA_CITY = { latitude: 41.6611, longitude: -91.5302 } // ~23 mi: inside the line
const DAVENPORT = { latitude: 41.5236, longitude: -90.5776 } // ~65 mi: well outside
const fix = (at: string, where: { latitude: number; longitude: number }): Fix => ({ driverCode: 'TEST', at, ...where })

const approvedStay = make({ status: 'APPROVED', decidedAt: '2026-09-26T12:00:00Z', homeBy: '2026-09-27T00:00:00Z', backOut: '2026-09-28T12:00:00Z' })
const track: Fix[] = [
  fix('2026-09-26T21:00:00Z', DAVENPORT),
  fix('2026-09-26T22:30:00Z', HOME), // home...
  fix('2026-09-27T01:00:00Z', HOME),
  fix('2026-09-27T09:00:00Z', HOME), // ...all night
  fix('2026-09-28T11:30:00Z', DAVENPORT), // and gone the next morning
  fix('2026-09-28T13:00:00Z', DAVENPORT),
]

test('GeoTab sees a truck come home, stay, and leave -- two moves, in order', () => {
  const moves = detectHomeMoves([approvedStay], track, [HOME], { now: '2026-09-28T15:00:00Z' })
  assert.deepEqual(moves.map((m) => [m.action.type, m.action.at]), [
    ['arrive', '2026-09-26T22:30:00.000Z'],
    ['leave', '2026-09-28T11:30:00.000Z'],
  ])
})

test('applying the moves in order takes the stay home and then to done, as GeoTab', () => {
  let stay = approvedStay
  for (const m of detectHomeMoves([approvedStay], track, [HOME], { now: '2026-09-28T15:00:00Z' })) {
    const r = applyAction(stay, m.action, { now: '2026-09-28T15:00:00Z', by: null, source: 'GEOTAB' })
    assert.ok('stay' in r, 'error' in r ? r.error : '')
    stay = r.stay
  }
  assert.equal(stay.status, 'DONE')
  assert.equal(stay.arrivedSource, 'GEOTAB')
  assert.equal(stay.leftSource, 'GEOTAB')
  // And it is not suggested again: the stay has moved on.
  assert.deepEqual(detectHomeMoves([stay], track, [HOME], { now: '2026-09-28T15:00:00Z' }), [])
})

test('driving through town is not coming home', () => {
  const through: Fix[] = [
    fix('2026-09-27T10:00:00Z', DAVENPORT),
    fix('2026-09-27T12:00:00Z', IOWA_CITY), // inside the line for ten minutes
    fix('2026-09-27T12:10:00Z', DAVENPORT),
    fix('2026-09-27T14:00:00Z', DAVENPORT),
  ]
  assert.deepEqual(detectHomeMoves([approvedStay], through, [HOME], { now: '2026-09-27T15:00:00Z' }), [])
})

test('home a little under half an hour is not yet home -- until it has been', () => {
  const justIn: Fix[] = [fix('2026-09-27T09:00:00Z', DAVENPORT), fix('2026-09-27T14:40:00Z', HOME)]
  assert.deepEqual(detectHomeMoves([approvedStay], justIn, [HOME], { now: '2026-09-27T15:00:00Z' }), [])
  assert.equal(detectHomeMoves([approvedStay], justIn, [HOME], { now: '2026-09-27T15:15:00Z' }).length, 1)
})

test('a driver home before dispatch clicked Approve still arrived when they arrived', () => {
  const early = make({ status: 'APPROVED', decidedAt: '2026-09-27T03:00:00Z' })
  const moves = detectHomeMoves([early], track, [HOME], { now: '2026-09-27T10:00:00Z' })
  assert.deepEqual(moves.map((m) => m.action.at), ['2026-09-26T22:30:00.000Z'])
})

test('requests, unplaced homes and other drivers are left alone', () => {
  assert.deepEqual(detectHomeMoves([make({ status: 'REQUESTED' })], track, [HOME], { now: '2026-09-28T15:00:00Z' }), [], 'not approved')
  assert.deepEqual(detectHomeMoves([approvedStay], track, [{ driverCode: 'TEST', latitude: null, longitude: null }], { now: '2026-09-28T15:00:00Z' }), [], 'no home position')
  assert.deepEqual(detectHomeMoves([{ ...approvedStay, driverCode: 'OTHER' }], track, [HOME], { now: '2026-09-28T15:00:00Z' }), [], 'not their truck')
})
