import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkSourceRows, checkStatusRows, sourceIds, statusIds } from './lookups.ts'
import type { StaySourceRow, StayStatusRow } from './lookups.ts'

// Both tables exactly as SELECT * returned them on 2026-09-29, the day they
// were created through the app -- placeholder rows and all.
const read = <T>(file: string) => JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')) as T
const statuses = read<StayStatusRow[]>('statuses.json')
const sources = read<StaySourceRow[]>('sources.json')

function edited<T>(rows: T[], change: (rows: T[]) => void): T[] {
  const copy = structuredClone(rows)
  change(copy)
  return copy
}
const status = (list: StayStatusRow[], name: string) => {
  const row = list.find((r) => r.Home_Time_Status === name)
  if (!row) throw new Error(`no status row ${name}`)
  return row
}
const source = (list: StaySourceRow[], name: string) => {
  const row = list.find((r) => r.Home_Time_Source === name)
  if (!row) throw new Error(`no source row ${name}`)
  return row
}

// ---------------------------------------------------------------------------
// DRVR.fk_Home_Time_Status
// ---------------------------------------------------------------------------
test('the status table as the app created it agrees with the schedule', () => {
  assert.deepEqual(checkStatusRows(statuses), [])
})

test('each status maps to the Id a stay\'s foreign key holds, and the placeholder to nothing', () => {
  assert.deepEqual(statusIds(statuses), { REQUESTED: 1, APPROVED: 2, HOME: 3, DONE: 4, DECLINED: 5, CANCELLED: 6 })
})

test('a status renamed in the app is two problems: an unknown name, and a status with no row', () => {
  const problems = checkStatusRows(edited(statuses, (r) => { status(r, 'DONE').Home_Time_Status = 'COMPLETE' }))
  assert.equal(problems.length, 2, problems.join('\n'))
  assert.match(problems[0] ?? '', /"COMPLETE" is not a status the schedule knows/)
  assert.match(problems[1] ?? '', /uses "DONE", but the table has no row/)
})

test('a near miss, an inactive status and a duplicate are each named', () => {
  assert.match(checkStatusRows(edited(statuses, (r) => { status(r, 'HOME').Home_Time_Status = 'Home' })).join('\n'), /"Home" differs from "HOME"/)
  const off = edited(statuses, (r) => { status(r, 'APPROVED').IsActive = 0 })
  assert.match(checkStatusRows(off).join('\n'), /"APPROVED" is marked inactive/)
  assert.equal(statusIds(off).APPROVED, undefined)
  const dup = edited(statuses, (r) => { r.push({ ...status(r, 'HOME'), Home_Time_Status_Id: 7, Choice_Key: 'g' }) })
  assert.match(checkStatusRows(dup).join('\n'), /"HOME" appears more than once/)
})

// ---------------------------------------------------------------------------
// DRVR.fk_Home_Time_Source -- including OTHER, the row the app's table had
// that the code did not, until the code was made to agree with it.
// ---------------------------------------------------------------------------
test('the source table as the app created it agrees with the schedule', () => {
  assert.deepEqual(checkSourceRows(sources), [])
})

test('each source maps to the Id an arrival or departure stores', () => {
  assert.deepEqual(sourceIds(sources), { DISPATCH: 1, GEOTAB: 2, OTHER: 3 })
})

test('a source the code has never heard of is named, and so is one the table lacks', () => {
  const added = edited(sources, (r) => { r.push({ ...source(r, 'OTHER'), Home_Time_Source_Id: 4, Home_Time_Source: 'DRIVER_APP', Choice_Key: 'd' }) })
  assert.match(checkSourceRows(added).join('\n'), /"DRIVER_APP" is not a source the schedule knows, so no arrival or departure will ever be recorded with it/)
  const gone = edited(sources, (r) => { r.splice(r.indexOf(source(r, 'GEOTAB')), 1) })
  assert.deepEqual(checkSourceRows(gone), ['the schedule uses "GEOTAB", but the table has no row for it'])
})

test('a lowercase source is a near miss, not a match', () => {
  assert.match(checkSourceRows(edited(sources, (r) => { source(r, 'GEOTAB').Home_Time_Source = 'geotab' })).join('\n'), /"geotab" differs from "GEOTAB"/)
})
