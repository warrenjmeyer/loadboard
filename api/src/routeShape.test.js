const test = require('node:test')
const assert = require('node:assert/strict')
const { simplify, round } = require('./routeShape')

// ---------------------------------------------------------------------------
// node --test
//
// The risk with thinning a line is not that it loses detail -- that is the
// point -- but that it loses the SHAPE: a route that detours a hundred miles
// round a lake must still detour round the lake, or the map shows a road
// that does not exist.
// ---------------------------------------------------------------------------

test('a straight road becomes two points', () => {
  const straight = [[42, -92], [42, -91.5], [42, -91], [42, -90.5], [42, -90]]
  assert.deepEqual(simplify(straight), [[42, -92], [42, -90]])
})

test('a detour survives, because it is the whole story', () => {
  // North a degree and back: the thing a straight line would deny.
  const detour = [[42, -92], [42.5, -91.5], [43, -91], [42.5, -90.5], [42, -90]]
  const thin = simplify(detour)
  assert.ok(thin.length >= 3, 'the turn is kept')
  assert.ok(thin.some(([lat]) => lat > 42.9), 'and so is how far north it went')
  assert.deepEqual(thin[0], [42, -92], 'both ends stay put')
  assert.deepEqual(thin[thin.length - 1], [42, -90])
})

test('wobble finer than the tolerance goes', () => {
  // A few metres of lane-change either side of a straight road.
  const wobbly = [[42, -92], [42.0005, -91.75], [41.9995, -91.5], [42.0005, -91.25], [42, -91]]
  assert.deepEqual(simplify(wobbly), [[42, -92], [42, -91]])
})

test('a real-sized route comes back small enough to draw', () => {
  // Three thousand points along a gentle curve, which is the shape of an
  // interstate: HERE sends about this many for a day's drive.
  const long = []
  for (let i = 0; i < 3000; i += 1) {
    const t = i / 2999
    long.push([42 + Math.sin(t * Math.PI) * 2, -92 + t * 6])
  }
  const thin = simplify(long)
  assert.ok(thin.length < 100, `3000 points thinned to ${thin.length}`)
  assert.ok(thin.length > 4, 'but the curve is still a curve')
  // The arc's high point is within a few hundred metres of where it was.
  const peak = Math.max(...thin.map(([lat]) => lat))
  assert.ok(Math.abs(peak - 44) < 0.02, `peak kept at ${peak}`)
})

test('too short to thin, and nothing at all', () => {
  assert.deepEqual(simplify([[42, -92], [43, -91]]), [[42, -92], [43, -91]])
  assert.deepEqual(simplify([[42, -92]]), [[42, -92]])
  assert.deepEqual(simplify([]), [])
  assert.deepEqual(simplify(null), [])
})

test('a bad point is dropped rather than drawn at the origin', () => {
  // Number(null) is 0, which is finite and in the Atlantic -- the same trap
  // the map and the ETA both had to be taught about.
  const withRubbish = [[42, -92], [null, -91], [43, -91], ['x', 0], [44, -90]]
  for (const [lat, lng] of simplify(withRubbish)) {
    assert.ok(Number.isFinite(lat) && Number.isFinite(lng))
  }
})

test('rounding stops at ten metres', () => {
  assert.deepEqual(round([[42.123456789, -92.987654321]]), [[42.1235, -92.9877]])
  assert.deepEqual(round([]), [])
})
