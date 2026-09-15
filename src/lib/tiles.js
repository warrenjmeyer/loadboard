// ---------------------------------------------------------------------------
// Slippy-map tiles, placed by the projection this app already has.
//
// The load map is an SVG drawn by mapProject.js: Web Mercator, one scale for
// both axes, a known centre. Raster map tiles are Web Mercator too, which is
// the whole reason a basemap can drop in behind the pins without a map
// library, a canvas, or a rewrite. A tile at zoom z covers an exact box of
// longitude and of Mercator latitude, and because the projection is LINEAR
// in both of those, that box lands as an exact axis-aligned rectangle on the
// page. No fudging, no resampling: an <image> at those coordinates is right.
//
// THE COST, which shapes the zoom choice below. Each tile request is one
// billed transaction. Measured on this app's own lanes, a view is four to
// six tiles at 512 px -- so a basemap costs a few ETAs, every time somebody
// opens a load with streets on. That is why the app draws none until asked,
// why the count is capped, and why the zoom is the coarsest that still
// looks sharp rather than the sharpest available.
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180

// HERE serves 256 or 512. 512 is four times the area per transaction, which
// on a metered basemap is the entire argument.
export const TILE_SIZE = 512

// Below 2 the whole world is a handful of tiles and the map is not a map;
// above 12 is a street map, which this picture never is -- and an uncapped
// zoom is an uncapped bill. The API proxy enforces the same range, because
// a limit that only exists in the browser is not a limit.
export const MIN_ZOOM = 2
export const MAX_ZOOM = 12

// A runaway view -- a lane across the country at a town's zoom -- could ask
// for thousands of tiles. It cannot: past this the map draws no basemap at
// all rather than a slow, expensive, partial one.
export const MAX_TILES = 40

export function lonToTileX(lon, z) {
  return ((Number(lon) + 180) / 360) * 2 ** z
}

export function latToTileY(lat, z) {
  const rad = Math.max(-85.05112878, Math.min(85.05112878, Number(lat))) * DEG
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z
}

export function tileXToLon(x, z) {
  return (Number(x) / 2 ** z) * 360 - 180
}

export function tileYToLat(y, z) {
  const n = Math.PI - 2 * Math.PI * (Number(y) / 2 ** z)
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

// Which zoom shows tiles at about their own resolution.
//
// `scale` is what layout() computed: pixels per degree of longitude, in the
// SVG's own units. A tile at zoom z is TILE_SIZE pixels across 360/2^z
// degrees, so it draws at TILE_SIZE * 2^z / 360 pixels per degree. Solving
// for the z where those match gives the zoom that needs neither stretching
// nor shrinking.
//
// Two corrections to that, both learned by looking at the result:
//
// ROUNDED, not floored. Flooring can leave a tile stretched to twice its
// resolution, and a basemap blurred to save a transaction is a basemap not
// worth fetching -- the whole point of pressing Streets is to see the roads.
// Rounding costs more tiles on some views and gives a sharp picture on all
// of them.
//
// BIASED UP a little, because `scale` is in viewBox units and the SVG is
// displayed wider than its 640: a full-width map on a laptop is nearer 900
// real pixels, which is about half a zoom level of extra sharpness needed.
// Without this the arithmetic is right about the wrong picture.
const SHARPNESS_BIAS = 0.4

export function chooseZoom(scale, { tileSize = TILE_SIZE, min = MIN_ZOOM, max = MAX_ZOOM } = {}) {
  if (!Number.isFinite(scale) || scale <= 0) return min
  const z = Math.round(Math.log2((scale * 360) / tileSize) + SHARPNESS_BIAS)
  return Math.max(min, Math.min(max, z))
}

// Every tile the view touches, at that zoom.
//
// The view is in degrees, so its edges convert straight to fractional tile
// coordinates; the tiles wanted are the whole numbers spanning them. Tiles
// off the edge of the world are dropped rather than clamped: asking for row
// -1 is asking for sky.
export function tilesFor(view, z) {
  if (!view) return []
  const n = 2 ** z
  const x0 = Math.floor(lonToTileX(view.west, z))
  const x1 = Math.ceil(lonToTileX(view.east, z))
  // North is a SMALLER y in tile coordinates, so the top edge is the north one.
  const y0 = Math.floor(latToTileY(view.north, z))
  const y1 = Math.ceil(latToTileY(view.south, z))

  const wide = x1 - x0
  const tall = y1 - y0
  if (wide <= 0 || tall <= 0) return []
  if (wide * tall > MAX_TILES) return []

  const out = []
  for (let x = x0; x < x1; x += 1) {
    for (let y = y0; y < y1; y += 1) {
      if (y < 0 || y >= n) continue
      // Longitude wraps; a lane either side of the date line is not a case
      // this fleet has, but wrapping costs one modulo and a wrong tile is
      // the kind of bug nobody sees until they see it.
      const wrapped = ((x % n) + n) % n
      out.push({ z, x: wrapped, y })
    }
  }
  return out
}

// Where one tile goes on the page, through the map's own projection.
//
// Both corners are projected rather than one corner plus a computed size:
// the arithmetic is then the map's, not a second copy of it, and the tile
// cannot drift away from the pins drawn over it.
export function tileRect(tile, project) {
  if (!tile || typeof project !== 'function') return null
  const nw = project(tileXToLon(tile.x, tile.z), tileYToLat(tile.y, tile.z))
  const se = project(tileXToLon(tile.x + 1, tile.z), tileYToLat(tile.y + 1, tile.z))
  const width = se.x - nw.x
  const height = se.y - nw.y
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return { x: nw.x, y: nw.y, width, height }
}

// The app's own tile URL. The key is not in it: /api/maptile proxies to HERE
// with the credential held server-side, which is the only reason a basemap
// could be added at all without shipping a secret to every visitor.
export function tileUrl(tile) {
  return `/api/maptile/${tile.z}/${tile.x}/${tile.y}`
}
