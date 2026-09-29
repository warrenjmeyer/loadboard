import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkStatusRows, statusIds } from './statusTable.ts'
import type { StayStatusRow } from './statusTable.ts'

// The table exactly as SELECT * returned it on 2026-09-29, the day it was
// created through the app -- placeholder row and all.
const rows = JSON.parse(readFileSync(new URL('./fixtures/statuses.json', import.meta.url), 'utf8')) as StayStatusRow[]

function edited(change: (rows: StayStatusRow[]) => void): StayStatusRow[] {
  const copy = structuredClone(rows)
  change(copy)
  return copy
}
const named = (list: StayStatusRow[], name: string) => {
  const row = list.find((r) => r.Home_Time_Status === name)
  if (!row) throw new Error(`no row named ${name}`)
  return row
}

test('the table as the app created it agrees with the schedule', () => {
  assert.deepEqual(checkStatusRows(rows), [])
})

test('each status maps to the Id a stay\'s foreign key holds, and the placeholder to nothing', () => {
  assert.deepEqual(statusIds(rows), { REQUESTED: 1, APPROVED: 2, HOME: 3, DONE: 4, DECLINED: 5, CANCELLED: 6 })
})

test('a row renamed in the app is two problems: an unknown name, and a status with no row', () => {
  const problems = checkStatusRows(edited((r) => { named(r, 'DONE').Home_Time_Status = 'COMPLETE' }))
  assert.equal(problems.length, 2, problems.join('\n'))
  assert.match(problems[0] ?? '', /"COMPLETE" is not a status the schedule knows/)
  assert.match(problems[1] ?? '', /uses "DONE", but the table has no row/)
})

test('a near miss, an inactive row and a duplicate are each named', () => {
  assert.match(checkStatusRows(edited((r) => { named(r, 'HOME').Home_Time_Status = 'Home' })).join('\n'), /"Home" differs from "HOME"/)
  const off = edited((r) => { named(r, 'APPROVED').IsActive = 0 })
  assert.match(checkStatusRows(off).join('\n'), /"APPROVED" is marked inactive/)
  assert.equal(statusIds(off).APPROVED, undefined)
  const dup = edited((r) => { r.push({ ...named(r, 'HOME'), Home_Time_Status_Id: 7, Choice_Key: 'g' }) })
  assert.match(checkStatusRows(dup).join('\n'), /"HOME" appears more than once/)
})
