// ---------------------------------------------------------------------------
// node --test
//
// The load board's sort, tested without a browser or a database. Every case
// here is one that produced a wrong ORDER rather than an error -- which is the
// whole difficulty with sorting: nothing throws, the rows are simply in the
// wrong sequence, and a wrong sequence looks a lot like a right one.
// ---------------------------------------------------------------------------
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sortLoads, compareLoads } from './sortLoads.js'

// Deliberately out of order in every column, so no test can pass by accident
// on a list that was already sorted.
const LOADS = [
  { id: 'L-10412', origin: 'Dubuque', miles: 620, rate: 1550, status: 'Covered', driverCode: 'JSMITH' },
  { id: 'L-9999', origin: 'Ames', miles: 1200, rate: 1800, status: 'Available', driverCode: null },
  { id: 'L-10008', origin: 'Waterloo', miles: 310, rate: 1240, status: 'Available', driverCode: 'ACORTEZ' },
]

const order = (loads) => loads.map((l) => l.id)

test('no sort key leaves the order alone', () => {
  assert.deepEqual(order(sortLoads(LOADS, null, 'asc')), ['L-10412', 'L-9999', 'L-10008'])
})

test('sorts numbers by value, both ways', () => {
  assert.deepEqual(order(sortLoads(LOADS, 'miles', 'asc')), ['L-10008', 'L-10412', 'L-9999'])
  assert.deepEqual(order(sortLoads(LOADS, 'miles', 'desc')), ['L-9999', 'L-10412', 'L-10008'])
})

test('sorts strings alphabetically, not by subtraction', () => {
  // a - b on two strings is NaN, and a comparator returning NaN leaves the
  // array untouched -- so this failing looks exactly like the click doing
  // nothing at all.
  assert.deepEqual(order(sortLoads(LOADS, 'origin', 'asc')), ['L-9999', 'L-10412', 'L-10008'])
})

test('load ids sort numerically, so 9999 comes before 10008', () => {
  // Plain text collation compares "9" against "1" and puts L-9999 last. This
  // is the case that makes the numeric collation option worth having.
  assert.deepEqual(order(sortLoads(LOADS, 'id', 'asc')), ['L-9999', 'L-10008', 'L-10412'])
})

test('$/mi is computed, not read from a field', () => {
  // rpm exists on no load object. Sorting by rate/miles: 4.00, 1.50, 2.50.
  assert.deepEqual(order(sortLoads(LOADS, 'rpm', 'asc')), ['L-9999', 'L-10412', 'L-10008'])
})

test('empty cells sink in BOTH directions', () => {
  // L-9999 has no driver. Ascending or descending, it belongs at the bottom:
  // a descending sort that floats blanks to the top buries every row the
  // person was trying to see.
  assert.equal(order(sortLoads(LOADS, 'driverCode', 'asc')).at(-1), 'L-9999')
  assert.equal(order(sortLoads(LOADS, 'driverCode', 'desc')).at(-1), 'L-9999')
})

test('every load empty in a column leaves them in their existing order', () => {
  // What the public board sees: the API strips driverCode from anonymous
  // responses, so the whole column is null. Array.sort is stable, so equal
  // rows keep their relative positions.
  const anonymous = LOADS.map((l) => ({ ...l, driverCode: null }))
  assert.deepEqual(order(sortLoads(anonymous, 'driverCode', 'asc')), order(anonymous))
})

test('the original array is never reordered', () => {
  // The array the board sorts is React state. Sorting it in place would change
  // what is on screen without React hearing about it.
  const before = order(LOADS)
  sortLoads(LOADS, 'miles', 'desc')
  assert.deepEqual(order(LOADS), before)
})

test('comparing a row with itself is zero', () => {
  assert.equal(compareLoads(LOADS[0], LOADS[0], 'miles', 'asc'), 0)
})
