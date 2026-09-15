// ---------------------------------------------------------------------------
// node --test
//
// Tile arithmetic is the kind that fails quietly: an off-by-one in the row
// puts the basemap half a town north of the pins drawn on it, and the
// picture still looks like a map. These check it against places whose tile
// numbers are known, and against the projection the rest of the map uses --
// because agreeing with itself is the whole requirement.
// ---------------------------------------------------------------------------
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  lonToTileX, latToTileY, tileXToLon, tileYToLat,
  chooseZoom, tilesFor, tileRect, tileUrl,
  TILE_SIZE, MIN_ZOOM, MAX_ZOOM, MAX_TILES,
} from './tiles.js'
import { layout } from './mapProject.js'

const DUBUQUE = { latitude: 42.5006, longitude: -90.6646 }
const MINNEAPOLIS = { latitude: 44.9778, longitude: -93.265 }

test('the world is one tile at zoom 0 and four at zoom 1', () => {
  assert.equal(Math.floor(lonToTileX(-179, 0)), 0)
  assert.equal(Math.floor(lonToTileX(179, 0)), 0)
  assert.equal(Math.floor(latToTileY(85, 0)), 0)
  // The prime meridian is the seam between the two columns at zoom 1, and
  // the equator the seam between the two rows.
  assert.equal(lonToTileX(0, 1), 1)
  assert.ok(Math.abs(latToTileY(0, 1) - 1) < 1e-9)
})

test('Dubuque lands on the tile the probe actually fetched', () => {
  // tools/here-tile-probe.mjs computed z11 x=508 y=756 from its own copy of
  // this arithmetic, asked HERE for it, and got back a picture of Dubuque
  // with the Mississippi through it. Two implementations written separately
  // agreeing on the same tile, and that tile being the right town, is the
  // evidence that the basemap will land under the pins rather than beside
  // them. If this ever fails, the map has moved and the pins have not.
  assert.equal(Math.floor(lonToTileX(DUBUQUE.longitude, 11)), 508)
  assert.equal(Math.floor(latToTileY(DUBUQUE.latitude, 11)), 756)
})

test('tile coordinates round-trip back to degrees', () => {
  for (const z of [2, 6, 11]) {
    for (const p of [DUBUQUE, MINNEAPOLIS]) {
      const x = lonToTileX(p.longitude, z)
      const y = latToTileY(p.latitude, z)
      assert.ok(Math.abs(tileXToLon(x, z) - p.longitude) < 1e-9, `lon at z${z}`)
      assert.ok(Math.abs(tileYToLat(y, z) - p.latitude) < 1e-7, `lat at z${z}`)
    }
  }
})

test('north is a smaller row number, and south is bigger', () => {
  // The one that is easy to get backwards: y grows DOWNWARD, like the SVG
  // it is drawn into and unlike latitude.
  assert.ok(latToTileY(MINNEAPOLIS.latitude, 8) < latToTileY(DUBUQUE.latitude, 8))
})

test('the zoom chosen is sharp enough, and never wildly sharper', () => {
  // The band the rounding has to stay inside. A tile may be drawn somewhat
  // smaller than its own resolution -- downscaling looks fine -- but it must
  // never be stretched much, because a blurred basemap is the one outcome
  // that makes pressing Streets pointless. The upper bound is the bill:
  // every extra zoom level is four times the tiles.
  for (const scale of [20, 60, 150, 400, 900]) {
    const z = chooseZoom(scale)
    const tileScale = (TILE_SIZE * 2 ** z) / 360
    assert.ok(tileScale > scale * 0.95, `z${z} is not stretched at scale ${scale}`)
    assert.ok(tileScale < scale * 4, `z${z} is not absurdly sharper than the map at scale ${scale}`)
  }
})

test('the zoom is clamped at both ends, and nonsense gets the floor', () => {
  assert.equal(chooseZoom(0.0001), MIN_ZOOM)
  assert.equal(chooseZoom(1e9), MAX_ZOOM)
  assert.equal(chooseZoom(0), MIN_ZOOM)
  assert.equal(chooseZoom(-5), MIN_ZOOM)
  assert.equal(chooseZoom(NaN), MIN_ZOOM)
  assert.equal(chooseZoom(null), MIN_ZOOM)
})

test('the tiles cover the view and no more', () => {
  const { view, scale } = layout([DUBUQUE, MINNEAPOLIS], { width: 640, height: 360, fitSlack: 1.45 })
  const z = chooseZoom(scale)
  const tiles = tilesFor(view, z)
  assert.ok(tiles.length > 0 && tiles.length <= MAX_TILES)
  // Every tile is at the asked-for zoom and inside the world.
  for (const t of tiles) {
    assert.equal(t.z, z)
    assert.ok(t.x >= 0 && t.x < 2 ** z)
    assert.ok(t.y >= 0 && t.y < 2 ** z)
  }
  // The set spans the view's corners: the north-west tile is in it, and so
  // is the south-east one.
  const nw = { x: Math.floor(lonToTileX(view.west, z)), y: Math.floor(latToTileY(view.north, z)) }
  const se = { x: Math.floor(lonToTileX(view.east, z)), y: Math.floor(latToTileY(view.south, z)) }
  assert.ok(tiles.some((t) => t.x === nw.x && t.y === nw.y), 'north-west corner covered')
  assert.ok(tiles.some((t) => t.x === se.x && t.y === se.y), 'south-east corner covered')
})

test('an absurd number of tiles is no tiles at all', () => {
  // Rather than a slow, expensive, half-drawn basemap. The whole world at a
  // town's zoom is the case: thousands of tiles, thousands of transactions.
  const world = { west: -180, east: 180, south: -80, north: 80 }
  assert.deepEqual(tilesFor(world, 10), [])
  assert.deepEqual(tilesFor(null, 8), [])
})

test('a tile is placed by the map projection, not beside it', () => {
  const { project, view, scale } = layout([DUBUQUE, MINNEAPOLIS], { width: 640, height: 360, fitSlack: 1.45 })
  const z = chooseZoom(scale)
  const tiles = tilesFor(view, z)
  for (const t of tiles) {
    const rect = tileRect(t, project)
    assert.ok(rect, 'every tile has a rectangle')
    assert.ok(rect.width > 0 && rect.height > 0)
    // Square in Mercator, square on the page: the same scale on both axes is
    // what makes the tile land without distortion, and a difference here
    // means the basemap is being stretched over the pins.
    assert.ok(Math.abs(rect.width - rect.height) < 0.01, 'tiles stay square')
  }
  // Neighbours abut exactly -- no seams, no overlap.
  const a = tiles[0]
  const right = tiles.find((t) => t.x === a.x + 1 && t.y === a.y)
  if (right) {
    const ra = tileRect(a, project)
    const rb = tileRect(right, project)
    assert.ok(Math.abs((ra.x + ra.width) - rb.x) < 0.01, 'the next tile starts where this one ends')
  }
})

test('a tile covering a stop puts it inside its own rectangle', () => {
  // The claim that matters: the basemap under a pin is the basemap OF that
  // pin's place. Dubuque's pin must fall within the rectangle of the tile
  // whose numbers Dubuque's coordinates produce.
  const { project, scale } = layout([DUBUQUE, MINNEAPOLIS], { width: 640, height: 360, fitSlack: 1.45 })
  const z = chooseZoom(scale)
  const tile = { z, x: Math.floor(lonToTileX(DUBUQUE.longitude, z)), y: Math.floor(latToTileY(DUBUQUE.latitude, z)) }
  const rect = tileRect(tile, project)
  const pin = project(DUBUQUE.longitude, DUBUQUE.latitude)
  assert.ok(pin.x >= rect.x && pin.x <= rect.x + rect.width, 'pin is within the tile horizontally')
  assert.ok(pin.y >= rect.y && pin.y <= rect.y + rect.height, 'pin is within the tile vertically')
})

test('the tile url carries no credential', () => {
  const url = tileUrl({ z: 8, x: 62, y: 93 })
  assert.equal(url, '/api/maptile/8/62/93')
  assert.ok(!/key|api[-_]?key/i.test(url), 'the browser never sees the HERE key')
})
