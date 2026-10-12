import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { homeTimeFor } from './home-time-schedule/rules.ts'
import type { ScheduleData } from './home-time-schedule/contract.ts'
import type { Roster } from './get-me-home/contract.ts'
import { scheduleDrive } from './get-me-home/planHome.ts'
import { planWithLegs } from './driver-load-plans/rules.ts'
import type { DriveFn } from './driver-load-plans/rules.ts'
import type { LoadPlanData } from './driver-load-plans/contract.ts'
import { homeTimeRule } from './driver-master/rules.ts'
import type { DriverRecord } from './driver-master/contract.ts'
import { jobTypeOf } from './get-me-home/adapters/loadboardRoster.ts'

// ---------------------------------------------------------------------------
// The three tabs' sample data tell one story.
//
// The planner's sample roster says, for each driver, when they were last home
// and when they asked to be home by. The schedule's sample stays are where
// those facts come from. On the preview page the planner's are replaced by
// the schedule's (approve a request there and the planner sees it), so if the
// two samples disagreed, the planner would change the moment the page loaded
// -- and a screenshot of one tab would contradict the other.
//
// This lives beside the features, not in either: it is about the load
// board's sample data, and neither folder should have to carry the other.
// ---------------------------------------------------------------------------
const read = <T>(path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T
const roster = read<Roster>('./get-me-home/fixtures/roster.json')
const schedule = read<ScheduleData>('./home-time-schedule/fixtures/schedule.json')
const plans = read<LoadPlanData>('./driver-load-plans/fixtures/plans.json')

// Compared as instants, not strings: "-05:00" and "Z" can name the same moment.
const same = (a: string | null | undefined, b: string | null | undefined) =>
  (a == null && b == null) || (a != null && b != null && Date.parse(a) === Date.parse(b))

test('both samples run on the same clock', () => {
  assert.equal(roster.asOf, schedule.asOf)
})

test('every planner driver\'s home time is what their stays say', () => {
  for (const d of roster.drivers) {
    const fromStays = homeTimeFor(schedule.stays, d.driverCode, schedule.asOf!)
    assert.ok(same(fromStays.lastHomeAt, d.homeTime.lastHomeAt), `${d.driverCode} last home: ${fromStays.lastHomeAt} vs ${d.homeTime.lastHomeAt}`)
    assert.ok(same(fromStays.requestedBy, d.homeTime.requestedBy), `${d.driverCode} home by: ${fromStays.requestedBy} vs ${d.homeTime.requestedBy}`)
    assert.equal(fromStays.note ?? null, d.homeTime.note ?? null, `${d.driverCode} note`)
  }
})

// ---------------------------------------------------------------------------
// The load plans' sample is the same company on the same Monday: the
// planner's drivers, where the planner has them, with the planner's hours --
// and the schedule's approved and current stays. On the preview page the
// load plans' stays are replaced by the schedule's as they stand, so a
// disagreement here would change the tab the moment the page loaded.
// ---------------------------------------------------------------------------
test('the load plans run on the same clock', () => {
  assert.equal(plans.asOf, roster.asOf)
})

test('every planner driver is a load-plan driver, in the same place with the same hours', () => {
  for (const d of roster.drivers) {
    const p = plans.drivers.find((x) => x.driverCode === d.driverCode)
    assert.ok(p, `${d.driverCode} is missing from the load plans`)
    assert.equal(p.name, d.name)
    assert.equal(p.unitNo, d.unitNo)
    assert.equal(p.position?.latitude ?? null, d.position?.latitude ?? null, `${d.driverCode} latitude`)
    assert.equal(p.position?.longitude ?? null, d.position?.longitude ?? null, `${d.driverCode} longitude`)
    for (const k of ['driving', 'duty', 'cycle', 'rest'] as const) assert.equal(p.hours?.[k] ?? null, d.hours?.[k] ?? null, `${d.driverCode} hours.${k}`)
  }
  // And the load plans' drivers are the schedule's drivers.
  assert.deepEqual(plans.drivers.map((d) => d.driverCode).sort(), schedule.drivers.map((d) => d.driverCode).sort())
})

test('the load plans\' home time is the schedule\'s approved and current stays', () => {
  const fromSchedule = schedule.stays
    .filter((s) => s.status === 'APPROVED' || s.status === 'HOME')
    .map((s) => `${s.driverCode} ${Date.parse(s.homeBy)} ${Date.parse(s.backOut)} ${s.status}`).sort()
  const inPlans = plans.stays.map((s) => `${s.driverCode} ${Date.parse(s.homeBy)} ${Date.parse(s.backOut)} ${s.status}`).sort()
  assert.deepEqual(inPlans, fromSchedule)
})

test('the load under way is the one the planner has on the truck', () => {
  for (const d of roster.drivers) {
    const underWay = plans.loads.filter((l) => l.driverCode === d.driverCode && l.status === 'In Transit')
    assert.deepEqual(underWay.map((l) => l.id), d.currentLoad ? [d.currentLoad.id] : [], d.driverCode)
    if (d.currentLoad && underWay[0]) assert.ok(same(underWay[0].deliveryEnd, d.currentLoad.emptyAt), `${d.driverCode} empty at`)
  }
})

// The join the preview makes (wiring.ts), checked with the real hours model:
// the planner's clocks are what make Hollis late and Dale wait out a restart.
const driveFor: DriveFn = ({ driveSeconds, hours, startAt }) => {
  const s = scheduleDrive({ driveSeconds, hours, startAt })
  return s ? { arriveAt: s.arriveAt, restSeconds: s.offSeconds, hoursConsidered: true } : null
}

test('with the planner\'s hours model, Hollis is late for Omaha and Dale waits out a restart', () => {
  const hollis = planWithLegs(plans, 'HBARNETT', { now: plans.asOf!, drive: driveFor })[0]?.leg
  assert.equal(hollis?.verdict, 'LATE')
  assert.equal(planWithLegs(plans, 'HBARNETT', { now: plans.asOf! })[0]?.leg?.verdict, 'TIGHT', 'driving time alone says he makes it')
  const dale = planWithLegs(plans, 'DFOSTER', { now: plans.asOf!, drive: driveFor })[0]?.leg
  assert.equal(dale?.verdict, 'LATE')
  assert.ok((dale?.restSeconds ?? 0) >= 34 * 3600, 'a 34-hour restart before Ogden')
})

// The driver master is where the other tabs' drivers come from, so its
// sample must be the same people: the same names, homes and trucks as the
// load plans, and jobs that the planner counts as the job types its roster
// gives them.
const master = read<{ drivers: DriverRecord[] }>('./driver-master/fixtures/drivers.json').drivers

test('the driver master\'s drivers are the other tabs\' drivers', () => {
  const active = master.filter((d) => d.isActive)
  assert.deepEqual(active.map((d) => d.driverCode).sort(), plans.drivers.map((d) => d.driverCode).sort())
  for (const p of plans.drivers) {
    const m = active.find((d) => d.driverCode === p.driverCode)!
    assert.equal(`${m.firstName} ${m.lastName}`, p.name, p.driverCode)
    assert.equal(`${m.city}, ${m.state}`, p.home.place, `${p.driverCode} home`)
    assert.equal(m.unitNo, p.unitNo, `${p.driverCode} truck`)
  }
})

test('each master job counts, for home time, as the planner\'s roster says -- by both copies of the rule', () => {
  for (const r of roster.drivers) {
    const m = master.find((d) => d.driverCode === r.driverCode)!
    assert.equal(homeTimeRule(m.job), r.jobType, `${r.driverCode}: "${m.job}"`)
  }
  // The master's copy of jobTypeOf must say what the planner's says.
  for (const job of [...master.map((d) => d.job), 'Owner Operator', 'Over-the-road', 'Local Yard', '', null]) {
    assert.equal(homeTimeRule(job), jobTypeOf(job), JSON.stringify(job))
  }
})
