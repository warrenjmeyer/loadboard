const test = require('node:test')
const assert = require('node:assert/strict')
const { decode, FlexPolylineError } = require('./flexpolyline')

// ---------------------------------------------------------------------------
// node --test
//
// A decoder is either exactly right or it draws a confident line through the
// wrong country, so the first test is HERE's own published example with its
// own published answer. Everything else here is about failing loudly: a
// route drawn from a half-read string would look like a road.
// ---------------------------------------------------------------------------

// From the flexible-polyline specification: four points near Frankfurt,
// precision 5, no third dimension.
const SPEC_EXAMPLE = 'BFoz5xJ67i1B1B7PzIhaxL7Y'
const SPEC_ANSWER = [
  [50.10228, 8.69821],
  [50.10201, 8.69567],
  [50.10063, 8.69150],
  [50.09878, 8.68752],
]

test("HERE's own example decodes to HERE's own answer", () => {
  assert.deepEqual(decode(SPEC_EXAMPLE), SPEC_ANSWER)
})

test('the first point is absolute and the rest are deltas', () => {
  // The property that makes the format small and makes a misread
  // catastrophic rather than slightly off: every point after the first is
  // relative, so one wrong value bends the whole tail of the route.
  const points = decode(SPEC_EXAMPLE)
  assert.equal(points.length, 4)
  // Consecutive points are metres apart, not degrees -- proof the deltas
  // were applied rather than treated as absolute positions.
  for (let i = 1; i < points.length; i += 1) {
    assert.ok(Math.abs(points[i][0] - points[i - 1][0]) < 0.01, 'latitudes step, not jump')
    assert.ok(Math.abs(points[i][1] - points[i - 1][1]) < 0.01, 'longitudes step, not jump')
  }
})

test('nothing in, nothing out', () => {
  assert.deepEqual(decode(''), [])
  assert.deepEqual(decode(null), [])
  assert.deepEqual(decode(undefined), [])
})

test('a string this does not understand is an error, not a guess', () => {
  // Better a 502 than a line drawn through the Atlantic.
  assert.throws(() => decode('!!!!'), FlexPolylineError)
  // Version 2, one day, will need code -- and until it does it must refuse
  // rather than read version 2 with version 1 rules.
  assert.throws(() => decode('CFoz5xJ67i1B'), FlexPolylineError)
  // A value whose continuation bit promises another chunk that never comes.
  assert.throws(() => decode('BFoz5xJ6'), FlexPolylineError)
})

test('coordinates come back at the precision the header declares', () => {
  // Precision 5 in the example: five decimal places, about a metre, which
  // is far finer than a line drawn at state scale needs and is why the
  // route is simplified before it is sent to the page.
  for (const [lat, lng] of decode(SPEC_EXAMPLE)) {
    assert.equal(Math.round(lat * 1e5) / 1e5, lat)
    assert.equal(Math.round(lng * 1e5) / 1e5, lng)
  }
})
