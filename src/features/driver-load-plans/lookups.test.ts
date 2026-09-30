import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkPlanStatusRows, planStatusIds } from './lookups.ts'
import type { PlanStatusRow } from './lookups.ts'

// The table exactly as SELECT * returned it on 2026-09-29, the day it was
// created through the app -- placeholder row and all.
const rows = JSON.parse(readFileSync(new URL('./fixtures/plan-statuses.json', import.meta.url), 'utf8')) as PlanStatusRow[]

function edited(change: (rows: PlanStatusRow[]) => void): PlanStatusRow[] {
  const copy = structuredClone(rows)
  change(copy)
  return copy
}
const row = (list: PlanStatusRow[], name: string) => {
  const found = list.find((r) => r.Load_Plan_Status === name)
  if (!found) throw new Error(`no status row ${name}`)
  return found
}

test('the status table as the app created it agrees with the load plans', () => {
  assert.deepEqual(checkPlanStatusRows(rows), [])
})

test('each status maps to the Id a plan\'s foreign key holds, and the placeholder to nothing', () => {
  assert.deepEqual(planStatusIds(rows), { PLANNED: 1, TAKEN_BACK: 2 })
})

test('the Ids are whatever the app handed out: made in the other order, they swap', () => {
  const swapped = edited((r) => { row(r, 'PLANNED').Load_Plan_Status_Id = 2; row(r, 'TAKEN_BACK').Load_Plan_Status_Id = 1 })
  assert.deepEqual(checkPlanStatusRows(swapped), [])
  assert.deepEqual(planStatusIds(swapped), { PLANNED: 2, TAKEN_BACK: 1 })
})

test('"Taken back" typed in the app is a near miss, said as one -- and TAKEN_BACK has no row', () => {
  const typed = edited((r) => { row(r, 'TAKEN_BACK').Load_Plan_Status = 'Taken back' })
  assert.deepEqual(checkPlanStatusRows(typed), [
    'row 2 (Id 2) "Taken back" differs from "TAKEN_BACK" only in case, spaces or underscores -- statuses are matched by exact name',
    'the load plans use "TAKEN_BACK", but the table has no row for it',
  ])
})

test('a row nobody uses, a duplicate, and an inactive row each say what they mean', () => {
  const messy = edited((r) => {
    r.push({ ...row(r, 'PLANNED'), Load_Plan_Status_Id: 3, Choice_Key: 'c' })
    r.push({ Load_Plan_Status_Id: 4, Load_Plan_Status: 'DISPATCHED', Choice_Key: 'd', IsActive: 1 })
    row(r, 'TAKEN_BACK').IsActive = 0
  })
  assert.deepEqual(checkPlanStatusRows(messy), [
    'row 2 (Id 2) "TAKEN_BACK" is marked inactive, but plans still move into it',
    'row 3 (Id 3) "PLANNED" appears more than once',
    'row 4 (Id 4) "DISPATCHED" is not a status the load plans know, so no plan will ever have it',
  ])
  assert.deepEqual(planStatusIds(messy), { PLANNED: 1 }, 'the first PLANNED, and no inactive TAKEN_BACK')
})

test('not rows at all is said plainly', () => {
  assert.deepEqual(checkPlanStatusRows(null), ['the status rows must be an array'])
  assert.deepEqual(checkPlanStatusRows([{ Load_Plan_Status_Id: 1 }]), ['row 0 (Id 1) has no Load_Plan_Status', 'the load plans use "PLANNED", but the table has no row for it', 'the load plans use "TAKEN_BACK", but the table has no row for it'])
})
