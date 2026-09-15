// ---------------------------------------------------------------------------
// node --test
//
// The arithmetic behind the load map. Nothing here throws when it is wrong;
// a mistake just puts a city in the wrong place on a picture that looks
// authoritative, which is the reason to test it rather than eyeball it.
// ---------------------------------------------------------------------------
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  layout, mercatorY, latitudeAt, milesBetween, isPlaceable, bordersInView, borderPath,
} from './mapProject.js'

const WATERLOO = { name: 'WATERLOO, IA', latitude: 42.4928, longitude: -92.3426 }
const MINNEAPOLIS = { name: 'MINNEAPOLIS, MN', latitude: 44.9778, longitude: -93.2650 }
const CHICAGO = { name: 'CHICAGO, IL', latitude: 41.8781, longitude: -87.6298 }
const DUBUQUE = { name: 'DUBUQUE, IA', latitude: 42.5006, longitude: -90.6646 }

const round = (n) => Math.round(n * 100) / 100

test('mercator stretches north, and the equator is zero', () => {
  // Within floating point of zero: log(tan(pi/4)) is 0 in arithmetic and
  // about -6e-15 in doubles.
  assert.ok(Math.abs(mercatorY(0)) < 1e-9)
  // At 42 degrees a degree of latitude is about 1.36 degrees of longitude on
  // a Mercator plot. If this were a plain lat/lon grid it would be 1.0 and
  // every east-west lane would look too long.
  const oneDegree = mercatorY(43) - mercatorY(42)
  assert.equal(round(oneDegree), 1.36)
  assert.ok(mercatorY(45) > mercatorY(44))
  // Clamped rather than infinite: a stray (0,0) or a typo must not produce
  // NaN geometry that silently blanks the whole map.
  assert.ok(Number.isFinite(mercatorY(90)))
  assert.ok(Number.isFinite(mercatorY(-90)))
})

test('a lane keeps its shape: one scale for both axes', () => {
  const { points, scale } = layout([WATERLOO, MINNEAPOLIS, CHICAGO], { width: 640, height: 360 })
  assert.equal(points.length, 3)
  // North is up.
  const [wat, mpls, chi] = points
  assert.ok(mpls.y < wat.y, 'Minneapolis is north of Waterloo, so higher on the page')
  assert.ok(chi.y > wat.y, 'Chicago is south of Waterloo')
  // East is right.
  assert.ok(chi.x > wat.x, 'Chicago is east of Waterloo')
  assert.ok(mpls.x < wat.x, 'Minneapolis is west of Waterloo')
  // The ratio of the drawn distances matches the ratio of the real ones,
  // which is what "preserves aspect" actually means to a reader.
  const drawn = Math.hypot(chi.x - wat.x, chi.y - wat.y) / Math.hypot(mpls.x - wat.x, mpls.y - wat.y)
  const real = milesBetween(WATERLOO, CHICAGO) / milesBetween(WATERLOO, MINNEAPOLIS)
  assert.ok(Math.abs(drawn - real) < 0.05, `drawn ${drawn} vs real ${real}`)
  assert.ok(scale > 0)
})

test('everything lands inside the box', () => {
  const box = { width: 400, height: 240, padding: 20 }
  for (const p of layout([WATERLOO, MINNEAPOLIS, CHICAGO, DUBUQUE], box).points) {
    assert.ok(p.x >= 0 && p.x <= box.width, `${p.name} x=${p.x}`)
    assert.ok(p.y >= 0 && p.y <= box.height, `${p.name} y=${p.y}`)
  }
})

test('one stop does not zoom to infinity', () => {
  // A single point has no extent. Without a floor on the span the scale is
  // Infinity and every coordinate becomes NaN.
  const { points, scale } = layout([WATERLOO], { width: 640, height: 360 })
  assert.equal(points.length, 1)
  assert.ok(Number.isFinite(scale))
  assert.equal(points[0].x, 320)
  assert.equal(points[0].y, 180)
})

test('two docks in one town stay legible', () => {
  // A hundredth of a degree apart. The minimum span keeps the zoom sane, so
  // they are two near pins rather than two pins filling the page.
  const a = { name: 'A', latitude: 42.49, longitude: -92.34 }
  const b = { name: 'B', latitude: 42.50, longitude: -92.33 }
  const { points } = layout([a, b], { width: 640, height: 360 })
  assert.ok(Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) < 20)
})

test('places with no coordinates are dropped, never drawn at the origin', () => {
  const rows = layout([WATERLOO, { name: 'NOWHERE' }, { name: 'BAD', latitude: null, longitude: -92 }], {}).points
  assert.deepEqual(rows.map((r) => r.name), ['WATERLOO, IA'])
  assert.deepEqual(layout([], {}).points, [])
  assert.deepEqual(layout(null, {}).points, [])
  assert.equal(isPlaceable(null), false)
  assert.equal(isPlaceable({ latitude: 42, longitude: -92 }), true)
})

test('miles between two cities are about right', () => {
  // Waterloo to Minneapolis is about 190 miles by road and 178 straight
  // line, which is the number this returns and the reason a lane label says
  // "as the crow flies" rather than pretending to be a route.
  assert.equal(Math.round(milesBetween(WATERLOO, MINNEAPOLIS)), 178)
  assert.equal(Math.round(milesBetween(WATERLOO, WATERLOO)), 0)
  assert.equal(milesBetween(WATERLOO, null), null)
})

test('fitTo zooms for the points that matter, not the background', () => {
  // The lane is Waterloo to Dubuque, 85 miles. Without fitTo the zoom would
  // be chosen to fit Omaha and Chicago too and the lane would be a knot in
  // the middle of the picture.
  const near = { name: 'DUBUQUE, IA', ...DUBUQUE, kind: 'stop' }
  const all = [{ ...WATERLOO, kind: 'stop' }, near, { ...CHICAGO, kind: 'ref' },
    { name: 'OMAHA, NE', latitude: 41.2565, longitude: -95.9345, kind: 'ref' }]
  const fitted = layout(all, { width: 640, height: 360, fitTo: (p) => p.kind === 'stop' })
  const unfitted = layout(all, { width: 640, height: 360 })
  const span = (r) => Math.abs(r.points[1].x - r.points[0].x)
  assert.ok(span(fitted) > span(unfitted) * 2, 'fitting to the stops zooms in on them')
  // A reference city outside the zoom is still positioned, just off the box.
  // The component drops those; the projection does not have to.
  assert.ok(fitted.points.some((p) => p.kind === 'ref' && (p.x < 0 || p.x > 640)))
})

// ---------------------------------------------------------------------------
// The geography behind the map.
// ---------------------------------------------------------------------------

test('mercator run backwards gives the latitude back', () => {
  for (const lat of [-44.5, 0, 25.76, 42.4928, 64.84]) {
    assert.ok(Math.abs(latitudeAt(mercatorY(lat)) - lat) < 1e-9, `${lat} round-trips`)
  }
})

test('project agrees with the points layout already returned', () => {
  // The whole reason project() is handed back rather than rewritten by the
  // caller: a border drawn with different arithmetic to the pins is a map
  // that disagrees with itself, and it would look plausible.
  const fitted = layout([WATERLOO, MINNEAPOLIS, CHICAGO], { width: 640, height: 360 })
  for (const p of fitted.points) {
    const { x, y } = fitted.project(p.longitude, p.latitude)
    assert.equal(round(x), round(p.x))
    assert.equal(round(y), round(p.y))
  }
})

test('the view is the slice of the world the box is showing', () => {
  const fitted = layout([WATERLOO, MINNEAPOLIS], { width: 640, height: 360 })
  const { view } = fitted
  assert.ok(view.west < -93.265 && view.east > -92.3426, 'holds both cities east to west')
  assert.ok(view.south < 42.4928 && view.north > 44.9778, 'and north to south')
  // The corners of the view are the corners of the box, by construction.
  const topLeft = fitted.project(view.west, view.north)
  assert.ok(Math.abs(topLeft.x) < 0.01, 'west edge is x = 0')
  assert.ok(Math.abs(topLeft.y) < 0.01, 'north edge is y = 0')
  const bottomRight = fitted.project(view.east, view.south)
  assert.ok(Math.abs(bottomRight.x - 640) < 0.01, 'east edge is the full width')
  assert.ok(Math.abs(bottomRight.y - 360) < 0.01, 'south edge is the full height')
})

test('nothing can be placed or seen on an empty map', () => {
  const empty = layout([], { width: 640, height: 360 })
  assert.equal(empty.project, null)
  assert.equal(empty.view, null)
  // And the border helpers say "nothing" rather than throwing, because a
  // null view reaches them on any load whose places GeoTab does not know.
  assert.deepEqual(bordersInView([[-92, 42, -91, 42]], empty.view), [])
  assert.equal(borderPath([-92, 42, -91, 42], empty.project), '')
})

test('borders outside the view are dropped, ones crossing it are kept', () => {
  const { view } = layout([WATERLOO, MINNEAPOLIS], { width: 640, height: 360 })
  const iowaish = [-93.5, 43.5, -92.5, 43.0]          // inside
  const crossing = [-120, 43.5, -70, 43.5]            // coast to coast, straight through
  const florida = [-81.5, 27.5, -80.5, 26.5]          // nowhere near
  const alaska = [-150, 61, -149, 61.5]
  const kept = bordersInView([iowaish, crossing, florida, alaska], view)
  assert.deepEqual(kept, [iowaish, crossing])
  // A line whose box only touches the edge is kept: over-including costs a
  // path the browser clips, under-including loses a border that shows.
  const justWest = [view.west - 0.4, 43, view.west + 0.05, 43]
  assert.equal(bordersInView([justWest], view).length, 1)
})

test('a border becomes path data, and one bad point cannot poison it', () => {
  const { project, view } = layout([WATERLOO, MINNEAPOLIS], { width: 640, height: 360 })
  const d = borderPath([-93.5, 43.5, -92.5, 43.0, -92.0, 42.5], project)
  assert.match(d, /^M[-\d.]+,[-\d.]+ L[-\d.]+,[-\d.]+ L[-\d.]+,[-\d.]+$/)
  assert.ok(!d.includes('NaN'))
  // The file is generated, so the component cannot assume it is clean. One
  // NaN in a path makes the browser drop the whole path, taking the good
  // half of the border with it -- so the line ends at the bad point.
  const truncated = borderPath([-93.5, 43.5, -92.5, 43.0, NaN, 42.5], project)
  assert.equal(truncated.split(' ').length, 2)
  // Too short to be a line at all.
  assert.equal(borderPath([-93.5, 43.5], project), '')
  assert.equal(borderPath(null, project), '')
  assert.ok(view)
})
