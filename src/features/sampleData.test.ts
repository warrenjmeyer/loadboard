import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { homeTimeFor } from './home-time-schedule/rules.ts'
import type { ScheduleData } from './home-time-schedule/contract.ts'
import type { Roster } from './get-me-home/contract.ts'

// ---------------------------------------------------------------------------
// The two tabs' sample data tell one story.
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
