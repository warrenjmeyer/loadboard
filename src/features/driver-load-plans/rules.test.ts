import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  FRESH_HOURS, assign, barFor, boardWindow, conflictsWith, deadhead, freeCounts, legTo, planFor, planWithLegs, plainDrive, positionOf,
  startFor, suggestDrivers, summarize, touches, unassign, whyNot,
} from './rules.ts'
import type { DriveFn, PlannedLoad } from './rules.ts'
import { checkLoadPlans } from './contract.ts'
import type { LoadPlanData, PlanLoad } from './contract.ts'

const data = JSON.parse(readFileSync(new URL('./fixtures/plans.json', import.meta.url), 'utf8')) as LoadPlanData
const NOW = data.asOf!
const nowMs = Date.parse(NOW)

function must<T>(value: T | null | undefined, what = 'a value'): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`)
  return value
}
const load = (id: string) => must(data.loads.find((l) => l.id === id), id)
const planned = (code: string, id: string): PlannedLoad => must(planWithLegs(data, code, { now: NOW }).find((p) => p.load.id === id), id)

// A stand-in for the planner's hours model, so these tests are about THIS
// folder's rules: an empty cycle means a 34-hour restart first, an empty
// driving clock a 10-hour rest. (The real model, joined in the preview, is
// checked beside it in src/features/sampleData.test.ts.)
const restWhenEmpty: DriveFn = ({ driveSeconds, hours, startAt }) => {
  const rest = (hours.cycle ?? 0) <= 0 ? 34 * 3600 : (hours.driving ?? 0) <= 0 ? 10 * 3600 : 0
  return { arriveAt: new Date(Date.parse(startAt) + (rest + driveSeconds) * 1000).toISOString(), restSeconds: rest, hoursConsidered: true }
}

// A load built from parts, so each test says only what it is about.
function make(overrides: Partial<PlanLoad> = {}): PlanLoad {
  return {
    id: 'T-1', status: 'Available', driverCode: null,
    origin: { place: 'Cedar Rapids, IA', latitude: 41.9779, longitude: -91.6656 },
    destination: { place: 'Chicago, IL', latitude: 41.8781, longitude: -87.6298 },
    pickupStart: '2026-09-29T12:00:00Z', pickupEnd: '2026-09-29T14:00:00Z',
    deliveryStart: '2026-09-29T18:00:00Z', deliveryEnd: '2026-09-29T20:00:00Z',
    miles: 220,
    ...overrides,
  }
}

test('the sample load plans match the contract', () => {
  assert.deepEqual(checkLoadPlans(data), [])
})

test('the contract check says what is wrong, in words', () => {
  assert.deepEqual(checkLoadPlans(null), ['the plan data must be an object'])
  const bad = { drivers: [], stays: [], loads: [make({ status: 'Covered', driverCode: null, pickupStart: '2026-09-29T12:00:00' })] }
  const problems = checkLoadPlans(bad)
  assert.ok(problems.some((p) => p.includes('Covered with no driver')), problems.join('; '))
  assert.ok(problems.some((p) => p.includes('has no time zone')), problems.join('; '))
})

test('empty miles are the planner\'s: a straight line stretched by a fifth, at 50 mph', () => {
  const dh = must(deadhead(load('L-30421').origin, { place: 'Kansas City, MO', latitude: 39.0997, longitude: -94.5786 }))
  assert.equal(dh.miles, 198)
  assert.equal(dh.driveSeconds, Math.round((198 / 50) * 3600))
  assert.equal(deadhead({ place: 'Nowhere', latitude: null, longitude: null }, load('L-30421').origin), null)
  assert.equal(deadhead({ place: 'Null Island', latitude: 0, longitude: 0 }, load('L-30421').origin), null, '0,0 is a missing fix, not a place')
})

test('a plan is the load under way first, then the rest by pickup -- and nothing delivered or cancelled', () => {
  assert.deepEqual(planFor(data, 'RDELGADO').map((l) => l.id), ['L-30412', 'L-30418'])
  assert.deepEqual(planFor(data, 'PRAMAN').map((l) => l.id), ['L-30430', 'L-30433'])
  assert.deepEqual(planFor(data, 'LHARTMAN'), [], 'Lena\'s delivered load is not on her plan')
})

test('the load under way has no leg: it is being driven', () => {
  assert.equal(planned('RDELGADO', 'L-30412').leg, null)
})

test('the next load starts where the last one delivers, when its window closes', () => {
  const leg = must(planned('RDELGADO', 'L-30418').leg)
  assert.deepEqual(leg.after, { kind: 'load', loadId: 'L-30412' })
  assert.equal(leg.from?.place, 'Joliet, IL')
  assert.equal(Date.parse(leg.readyAt), Date.parse('2026-09-28T16:00:00-05:00'))
  assert.equal(leg.deadheadMiles, 0)
  assert.equal(leg.verdict, 'ON_TIME')
})

test('a leg with less than two hours of the window left is TIGHT', () => {
  const leg = must(planned('PRAMAN', 'L-30433').leg)
  assert.equal(leg.deadheadMiles, 98)
  assert.equal(leg.verdict, 'TIGHT')
  assert.ok(must(leg.slackSeconds) > 0 && must(leg.slackSeconds) < 2 * 3600)
})

test('without an hours model a leg is driving time, and says so', () => {
  const leg = must(planned('HBARNETT', 'L-30421').leg)
  assert.equal(leg.hoursConsidered, false)
  assert.equal(leg.timingNote, 'Driving time only: no hours model was given.')
  assert.equal(leg.verdict, 'TIGHT')
})

test('with an hours model the same leg can be late -- the model is the host\'s to give', () => {
  const dale = must(planWithLegs(data, 'DFOSTER', { now: NOW, drive: restWhenEmpty })[0]?.leg)
  assert.equal(dale.hoursConsidered, true)
  assert.equal(dale.timingNote, null)
  assert.equal(dale.restSeconds, 34 * 3600)
  assert.equal(dale.verdict, 'LATE', 'Dale is out of cycle: a 34-hour restart before he can reach Ogden')
})

test('hours nobody knows are never guessed at: the leg says which ones', () => {
  // After a load: the hours then are unknown, whatever the model.
  const after = must(planWithLegs(data, 'RDELGADO', { now: NOW, drive: restWhenEmpty })[1]?.leg)
  assert.equal(after.hoursConsidered, false)
  assert.equal(after.timingNote, 'Driving time only: hours after L-30412 are not known yet.')
  // No hours from GeoTab at all.
  const lena = must(suggestDrivers(data, 'L-30452', { now: NOW, drive: restWhenEmpty }).find((c) => c.driverCode === 'LHARTMAN'))
  assert.equal(lena.leg.timingNote, 'Driving time only: GeoTab has no hours for this driver.')
})

test('a driver nobody can place is UNKNOWN, with the reason', () => {
  const rey = must(suggestDrivers(data, 'L-30450', { now: NOW }).find((c) => c.driverCode === 'RVASQUEZ'))
  assert.equal(rey.leg.verdict, 'UNKNOWN')
  assert.equal(rey.leg.unknownBecause, 'Nothing reports where the truck is.')
  assert.equal(rey.canTake, false)
  assert.equal(whyNot(rey), 'Nothing reports where the truck is.')
})

test('a load that runs into approved home time is a conflict', () => {
  const alma = planned('ACORTEZ', 'L-30425')
  assert.equal(alma.conflicts.length, 1)
  assert.equal(alma.conflicts[0]?.status, 'APPROVED')
  assert.equal(must(alma.leg).verdict, 'ON_TIME', 'she can reach it -- the problem is when, not whether')
  // The same stay, another driver's load: none of their business.
  assert.deepEqual(conflictsWith(load('L-30425'), 'PRAMAN', data.stays), [])
})

test('a driver at home starts from home when their stay ends -- rested, after a restart', () => {
  const start = startFor(data, 'MWEBB', load('L-30450'), nowMs)
  assert.deepEqual(start.after, { kind: 'home', backOut: '2026-09-29T11:00:00Z' })
  assert.equal(start.place?.place, 'Ames, IA')
  assert.equal(start.readyAt, Date.parse('2026-09-29T11:00:00Z'))
  assert.deepEqual(start.hours, FRESH_HOURS, 'two and a half days home is more than a 34-hour restart')
  // A stay shorter than a restart leaves the hours unknown.
  const short = { ...data, stays: [{ driverCode: 'MWEBB', homeBy: '2026-09-28T20:00:00Z', backOut: '2026-09-29T11:00:00Z', status: 'APPROVED' as const }] }
  assert.equal(startFor(short, 'MWEBB', load('L-30450'), nowMs).hours, null)
})

test('a stay or load that ends after the pickup closes is not where the leg starts', () => {
  // Alma's stay ends Oct 5; L-30451 picks up Sep 30 -- she goes from where she is.
  assert.deepEqual(startFor(data, 'ACORTEZ', load('L-30451'), nowMs).after, { kind: 'now' })
})

test('the plan\'s totals count loads, miles, and what needs a look', () => {
  const s = summarize(planWithLegs(data, 'PRAMAN', { now: NOW }))
  assert.deepEqual(s, { loads: 2, loadedMiles: 344, deadheadMiles: 98, legs: 2, unplacedLegs: 0, late: 0, tight: 1, clashes: 0 })
  assert.equal(summarize(planWithLegs(data, 'ACORTEZ', { now: NOW })).clashes, 1)
})

test('a leg nobody can place has unknown empty miles, not zero', () => {
  const unplaced: LoadPlanData = { ...data, drivers: data.drivers.map((d) => (d.driverCode === 'ACORTEZ' ? { ...d, position: null } : d)) }
  const s = summarize(planWithLegs(unplaced, 'ACORTEZ', { now: NOW }))
  assert.equal(s.legs, 1)
  assert.equal(s.unplacedLegs, 1)
  assert.equal(s.deadheadMiles, 0, 'the known miles only')
  // Rosa's only leg is from where her load under way delivers: placed.
  assert.equal(summarize(planWithLegs(data, 'RDELGADO', { now: NOW })).unplacedLegs, 0)
})

test('two loads of one driver at the same time overlap, and each says which', () => {
  const doubled: LoadPlanData = { ...data, loads: [...data.loads, make({ id: 'T-9', status: 'Covered', driverCode: 'SOAKS', pickupStart: '2026-09-28T18:30:00Z', pickupEnd: '2026-09-28T19:30:00Z', deliveryStart: '2026-09-28T20:00:00Z', deliveryEnd: '2026-09-28T22:00:00Z' })] }
  const plan = planWithLegs(doubled, 'SOAKS', { now: NOW })
  assert.equal(plan.find((p) => p.load.id === 'T-9')?.overlapsLoad, 'L-30440')
  assert.equal(plan.find((p) => p.load.id === 'L-30440')?.overlapsLoad, 'T-9')
})

// ---------------------------------------------------------------------------
// Suggesting a driver.
// ---------------------------------------------------------------------------
const codes = (id: string, drive?: DriveFn) => suggestDrivers(data, id, { now: NOW, drive }).map((c) => c.driverCode)

test('the nearest driver who can take it comes first', () => {
  assert.equal(codes('L-30450')[0], 'SOAKS', 'Sherman is 28 empty miles away, in Iowa City, when his load is done')
  assert.equal(codes('L-30451')[0], 'ACORTEZ', 'Alma is in Denver, and home time starts after she delivers')
  assert.equal(codes('L-30453')[0], 'LHARTMAN')
  assert.equal(codes('L-30454')[0], 'TBOONE')
})

test('the ones who cannot take it come after, each with the reason', () => {
  const list = suggestDrivers(data, 'L-30452', { now: NOW })
  assert.deepEqual(list.filter((c) => c.canTake).map((c) => c.driverCode), ['LHARTMAN'])
  const hollis = must(list.find((c) => c.driverCode === 'HBARNETT'))
  assert.equal(hollis.busyWith, 'L-30421')
  assert.equal(hollis.leg.deadheadMiles, 0, 'the nearest truck of all, and busy')
  assert.equal(whyNot(hollis), 'Busy with L-30421 then.')
  const marcus = must(list.find((c) => c.driverCode === 'MWEBB'))
  assert.equal(whyNot(marcus), 'It runs into their home time.')
  assert.ok(list.findIndex((c) => !c.canTake) > list.findIndex((c) => c.canTake))
})

test('a TIGHT arrival can still take it; a LATE one cannot', () => {
  const marcus = must(suggestDrivers(data, 'L-30450', { now: NOW }).find((c) => c.driverCode === 'MWEBB'))
  assert.equal(marcus.leg.verdict, 'TIGHT')
  assert.equal(marcus.canTake, true)
  const priya = must(suggestDrivers(data, 'L-30450', { now: NOW }).find((c) => c.driverCode === 'PRAMAN'))
  assert.equal(priya.leg.verdict, 'LATE')
  assert.equal(whyNot(priya), 'Cannot reach the pickup in its window.')
})

test('approving home time changes the suggestion', () => {
  // Terrell's request, approved: the Laredo load now runs into it.
  const approved: LoadPlanData = { ...data, stays: [...data.stays, { driverCode: 'TBOONE', homeBy: '2026-09-29T18:00:00-05:00', backOut: '2026-10-04T06:00:00-05:00', status: 'APPROVED' }] }
  const terrell = must(suggestDrivers(approved, 'L-30454', { now: NOW }).find((c) => c.driverCode === 'TBOONE'))
  assert.equal(terrell.canTake, false)
  assert.notEqual(suggestDrivers(approved, 'L-30454', { now: NOW })[0]?.driverCode, 'TBOONE')
})

test('only an Available load gets suggestions', () => {
  assert.deepEqual(suggestDrivers(data, 'L-30418', { now: NOW }), [])
  assert.deepEqual(suggestDrivers(data, 'L-99999', { now: NOW }), [])
})

// ---------------------------------------------------------------------------
// Putting loads on plans, and taking them off.
// ---------------------------------------------------------------------------
test('assigning covers an Available load with the driver; anything else is refused', () => {
  const done = assign(load('L-30450'), 'SOAKS')
  assert.ok('load' in done)
  assert.equal(done.load.status, 'Covered')
  assert.equal(done.load.driverCode, 'SOAKS')
  assert.deepEqual(assign(load('L-30418'), 'SOAKS'), { error: 'L-30418 is Covered with RDELGADO now, not Available.' })
  assert.deepEqual(assign(load('L-30450'), ''), { error: 'Choose a driver.' })
})

test('taking back makes a Covered load Available; one under way cannot come off', () => {
  const back = unassign(load('L-30418'))
  assert.ok('load' in back)
  assert.equal(back.load.status, 'Available')
  assert.equal(back.load.driverCode, null)
  assert.equal(back.load.plannedAt, null, 'off the plan, so no longer planned at any time')
  assert.deepEqual(unassign(load('L-30412')), { error: 'L-30412 is already under way; it cannot come off the plan.' })
  assert.deepEqual(unassign(load('L-30450')), { error: 'L-30450 is not on anyone\'s plan.' })
})

// ---------------------------------------------------------------------------
// The board.
// ---------------------------------------------------------------------------
test('the board is seven calendar days from midnight today', () => {
  const w = boardWindow(NOW)
  assert.equal(w.days.length, 7)
  const first = new Date(w.start)
  assert.equal(first.getHours(), 0)
  assert.equal(first.getDate(), new Date(NOW).getDate())
  assert.ok(w.days.every((d, i) => i === 0 || d.start === w.days[i - 1]!.end))
})

test('bars are fractions of the window, cut square where they run off it', () => {
  const w = boardWindow(NOW)
  const len = w.end - w.start
  const inside = must(barFor({ start: w.start + len / 4, end: w.start + len / 2 }, w))
  assert.deepEqual(inside, { left: 0.25, width: 0.25, clippedStart: false, clippedEnd: false })
  const over = must(barFor({ start: w.end - len / 10, end: w.end + len }, w))
  assert.equal(over.clippedEnd, true)
  assert.equal(barFor({ start: w.end + 1, end: w.end + 2 }, w), null)
  assert.equal(positionOf(NOW, w) !== null, true)
})

test('each day counts the drivers with nothing on it -- no load, no home time', () => {
  const free = freeCounts(data, boardWindow(NOW))
  assert.equal(free.length, 7)
  // Monday: Rosa, Hollis, Priya and Sherman are hauling, Marcus is home.
  assert.equal(free[0], data.drivers.length - 5)
  // Sunday: only Alma, home from Thursday to Monday.
  assert.equal(free[6], data.drivers.length - 1)
})

test('a span touches a window when any of it falls inside', () => {
  assert.equal(touches({ start: 10, end: 20 }, new Date(15).toISOString(), new Date(30).toISOString()), true)
  assert.equal(touches({ start: 10, end: 20 }, new Date(20).toISOString(), new Date(30).toISOString()), false)
  assert.equal(touches(null, NOW, NOW), false)
})

test('plainDrive arrives when the driving is done, and says it counted no hours', () => {
  assert.deepEqual(plainDrive({ driveSeconds: 3600, hours: FRESH_HOURS, startAt: '2026-09-28T15:00:00Z' }), {
    arriveAt: '2026-09-28T16:00:00.000Z', restSeconds: 0, hoursConsidered: false,
  })
  const leg = legTo(make(), { place: make().origin, readyAt: nowMs, hours: null, after: { kind: 'now' } })
  assert.equal(leg.deadheadMiles, 0)
})
