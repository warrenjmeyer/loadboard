// ---------------------------------------------------------------------------
// node --test
//
// stateOutlines.js is generated, and the thing about generated geography is
// that it fails quietly: a wrong sign or a missed transform draws a
// plausible-looking country in the wrong ocean, and the map still renders.
// These are the checks that would have caught that, and they are what makes
// re-running tools/gen-state-outlines.mjs safe.
// ---------------------------------------------------------------------------
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STATE_BORDERS } from './stateOutlines.js'

test('the borders are flat pairs of finite coordinates', () => {
  assert.ok(Array.isArray(STATE_BORDERS))
  for (const line of STATE_BORDERS) {
    assert.equal(line.length % 2, 0, 'a lone longitude means a dropped latitude')
    assert.ok(line.length >= 4, 'a line needs two points')
    for (const n of line) assert.ok(Number.isFinite(n))
  }
})

test('every point is somewhere in the United States', () => {
  // Latitude is the tight check: Hawaii at the bottom, the Alaskan north
  // coast on top. A transform applied wrongly lands in the Atlantic off
  // Africa at (0, 0) or in China with the signs swapped, and neither is
  // anywhere near this.
  //
  // Longitude cannot be checked the same way, because the western Aleutians
  // are genuinely in the EASTERN hemisphere: the chain runs past 180 and
  // comes back as +179. A hundred or so points here are positive and every
  // one of them is correct.
  for (const line of STATE_BORDERS) {
    for (let i = 0; i + 1 < line.length; i += 2) {
      const lon = line[i]
      const lat = line[i + 1]
      assert.ok(lon >= -180 && lon <= 180, `longitude ${lon} is not a longitude`)
      assert.ok(lon <= -66 || lon >= 170, `longitude ${lon} is not in the US`)
      assert.ok(lat >= 18 && lat <= 72, `latitude ${lat} is not in the US`)
    }
  }
})

test('no single line straddles the antimeridian', () => {
  // This one is about the map, not the data. A line holding both -179 and
  // +179 has a bounding box a whole world wide, so the view test would
  // find it visible from anywhere and draw it as a streak straight across
  // Iowa. As it happens each Aleutian island is its own arc and none of
  // them crosses, so nothing has to be split -- but if a future source file
  // changes that, this is the test that says so instead of the map.
  for (const line of STATE_BORDERS) {
    let west = false
    let east = false
    for (let i = 0; i + 1 < line.length; i += 2) {
      if (line[i] < -170) west = true
      if (line[i] > 170) east = true
    }
    assert.ok(!(west && east), 'a line wrapping the globe would draw across every map')
  }
})

test('the Mississippi is drawn once, not twice', () => {
  // The point of generating arcs rather than 50 polygons. If the generator
  // ever emits whole states instead, every interior border arrives twice and
  // the count roughly doubles -- visible as a heavier line between some
  // states than others, which reads as meaning something.
  assert.ok(STATE_BORDERS.length > 300 && STATE_BORDERS.length < 600,
    `${STATE_BORDERS.length} lines is not the shape of shared borders`)
  const points = STATE_BORDERS.reduce((total, line) => total + line.length / 2, 0)
  assert.ok(points > 6000 && points < 20000, `${points} points`)
})

test('the lower 48 are there, and so are Alaska and Hawaii', () => {
  const has = (west, east, south, north) => STATE_BORDERS.some((line) => {
    for (let i = 0; i + 1 < line.length; i += 2) {
      if (line[i] >= west && line[i] <= east && line[i + 1] >= south && line[i + 1] <= north) return true
    }
    return false
  })
  assert.ok(has(-92.5, -90, 40, 43.5), 'the Iowa side of the Mississippi')
  assert.ok(has(-125, -117, 32, 49), 'the Pacific coast')
  assert.ok(has(-71, -67, 41, 45), 'New England')
  assert.ok(has(-165, -141, 55, 71), 'Alaska')
  assert.ok(has(-160, -154, 18, 23), 'Hawaii')
  // Dropped on purpose by the generator: no truck reaches them.
  assert.ok(!has(-68, -64, 17, 19), 'Puerto Rico is not carried')
})

test('the geography agrees with the places GeoTab plots on it', () => {
  // The map draws Census borders under Geotab zone centres. Nothing forces
  // those two to agree, and a transform out by a degree would still look
  // like a map -- so this checks them against each other where the answer
  // is known: Dubuque is ON the Mississippi, which IS the Iowa/Illinois
  // border, and Chicago is ON Lake Michigan, which is drawn as Illinois's
  // eastern coast. Both pins must land within a couple of miles of a
  // border point, and Des Moines, in the middle of Iowa, must not.
  const nearest = (lon, lat) => {
    let best = Infinity
    for (const line of STATE_BORDERS) {
      for (let i = 0; i + 1 < line.length; i += 2) {
        const d = Math.hypot(line[i] - lon, line[i + 1] - lat)
        if (d < best) best = d
      }
    }
    return best
  }
  assert.ok(nearest(-90.6646, 42.5006) < 0.05, 'Dubuque sits on the river border')
  assert.ok(nearest(-87.6298, 41.8781) < 0.05, 'Chicago sits on the lake shore')
  assert.ok(nearest(-93.625, 41.5868) > 0.3, 'Des Moines is nowhere near a state line')
})
