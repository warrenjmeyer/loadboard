// ---------------------------------------------------------------------------
// node --test
//
// Written from a real screenshot. A load page showed two grey labels drawn
// across each other and across the lane:
//
//   "...nnorted Road, Hazel Green, WI 53811, Usa"
//   "4200 Mercy Dr, Dubuque, IA 52001, Usa"
//
// Both are honest Geotab zone names. Neither is a thing to write on a map of
// four states, and together they were a smear. These are the two rules that
// stop it.
// ---------------------------------------------------------------------------
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { looksLikeTown, labelBox, withoutCollisions } from './mapLabels.js'

test('a town is a name and a state, and nothing else is', () => {
  for (const good of ['DUBUQUE, IA', 'Waterloo, IA', 'CEDAR RAPIDS, IA', 'Sioux City, IA', 'Des Moines, IA']) {
    assert.equal(looksLikeTown(good), true, good)
  }
  for (const bad of [
    '4200 Mercy Dr, Dubuque, IA 52001, Usa',    // the one from the screenshot
    '11500 Unnorted Road, Hazel Green, WI 53811, Usa',
    'Dubuque',                                   // no state: might be anywhere
    'WAREHOUSE 3',
    'Somewhere, IA, Usa',                        // two commas: an address shape
    '',
    null,
    undefined,
  ]) {
    assert.equal(looksLikeTown(bad), false, String(bad))
  }
})

test('a name too long for the space is not drawn even if it parses', () => {
  // The shape test alone would pass this, and it would still be wider than
  // the gap between two pins.
  assert.equal(looksLikeTown('Really Very Extremely Long Townname, IA'), false)
})

test('a label box is where the text actually sits', () => {
  const start = labelBox(100, 50, 'Dubuque, IA')
  assert.equal(start.x1, 100)
  assert.ok(start.x2 > start.x1)
  assert.ok(start.y1 < start.y2, 'text sits above its baseline')

  // A stop name is centred over its pin, so its box straddles the point.
  const middle = labelBox(100, 50, 'Dubuque, IA', { anchor: 'middle' })
  assert.ok(middle.x1 < 100 && middle.x2 > 100)
  assert.equal(Math.round(middle.x2 - middle.x1), Math.round(start.x2 - start.x1))
})

test('labels that would land on each other are dropped, nearest first', () => {
  const at = (x, y, label) => ({ x, y, label })
  const kept = withoutCollisions([
    at(100, 50, 'Dubuque, IA'),
    at(104, 52, 'Asbury, IA'),      // four units away: the same place on screen
    at(300, 50, 'Chicago, IL'),     // clear of both
  ])
  assert.deepEqual(kept.map((k) => k.label), ['Dubuque, IA', 'Chicago, IL'])
})

test('the stops always win, because they are what the reader came for', () => {
  const reserved = [labelBox(100, 50, 'WATERLOO, IA', { anchor: 'middle' })]
  const kept = withoutCollisions([
    { x: 96, y: 52, label: 'Raymond, IA' },   // under the stop's own label
    { x: 400, y: 200, label: 'Madison, WI' },
  ], { reserved })
  assert.deepEqual(kept.map((k) => k.label), ['Madison, WI'])
})

test('nothing in, nothing out', () => {
  assert.deepEqual(withoutCollisions([]), [])
  assert.deepEqual(withoutCollisions(null), [])
})
