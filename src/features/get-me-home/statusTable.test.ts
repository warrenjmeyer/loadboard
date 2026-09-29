import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkStatusRows, statusIds } from './statusTable.ts'
import type { StatusRow } from './statusTable.ts'

// The table exactly as SELECT * returned it on 2026-09-29, the day it was
// created through the app -- placeholder row and all.
const rows = JSON.parse(readFileSync(new URL('./fixtures/statuses.json', import.meta.url), 'utf8')) as StatusRow[]

// The same rows with one thing changed, for the cases below.
function edited(change: (rows: StatusRow[]) => void): StatusRow[] {
  const copy = structuredClone(rows)
  change(copy)
  return copy
}
const named = (list: StatusRow[], name: string) => {
  const row = list.find((r) => r.fk_get_me_home_status === name)
  if (!row) throw new Error(`no row named ${name}`)
  return row
}

test('the table as the app created it agrees with the planner', () => {
  assert.deepEqual(checkStatusRows(rows), [])
})

test('each status maps to the Id a foreign key would hold, and the placeholder to nothing', () => {
  assert.deepEqual(statusIds(rows), {
    LATE: 1, TIGHT: 2, OVERDUE: 3, NOLOCATION: 4, SOON: 5, ONTRACK: 6, ONTHEROAD: 7, HOME: 8,
  })
})

test('a row renamed in the app is two problems: an unknown name, and a status with no row', () => {
  const problems = checkStatusRows(edited((r) => { named(r, 'ONTHEROAD').fk_get_me_home_status = 'ON_ROAD' }))
  assert.equal(problems.length, 2, problems.join('\n'))
  assert.match(problems[0] ?? '', /"ON_ROAD" is not a status the planner assigns/)
  assert.match(problems[1] ?? '', /assigns "ONTHEROAD", but the table has no row/)
})

test('a near miss in case or spacing is named as one', () => {
  const problems = checkStatusRows(edited((r) => { named(r, 'LATE').fk_get_me_home_status = 'Late ' }))
  assert.match(problems.join('\n'), /"Late " differs from "LATE" only in case or spaces/)
})

test('a status switched off in the app is flagged, and has no Id to store', () => {
  const off = edited((r) => { named(r, 'TIGHT').IsActive = 0 })
  assert.match(checkStatusRows(off).join('\n'), /"TIGHT" is marked inactive/)
  assert.equal(statusIds(off).TIGHT, undefined)
})

test('a duplicate and a deleted row are both caught', () => {
  const dup = edited((r) => { r.push({ ...named(r, 'HOME'), fk_get_me_home_status_Id: 9, Choice_Key: 'i' }) })
  assert.match(checkStatusRows(dup).join('\n'), /"HOME" appears more than once/)

  const gone = edited((r) => { r.splice(r.indexOf(named(r, 'HOME')), 1) })
  assert.deepEqual(checkStatusRows(gone), ['the planner assigns "HOME", but the table has no row for it'])
})

test('something that is not a list of rows says so', () => {
  assert.deepEqual(checkStatusRows(null), ['the status rows must be an array'])
  assert.equal(checkStatusRows([42])[0], 'row 0 is not an object')
})
