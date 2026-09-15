// ---------------------------------------------------------------------------
// Putting coordinates on an SVG, with no map library and no tiles.
//
// The load map draws a handful of cities and a truck. At that scale what a
// reader needs is which places, in what order, and roughly where each sits
// against the others -- not streets. So the whole thing is arithmetic:
// project the coordinates, fit them to a box, draw.
//
// WEB MERCATOR, not raw latitude. Plotting latitude directly as y is the
// obvious thing and it leans: across the Midwest, a degree of longitude is
// about three quarters of a degree of latitude on the ground, and a lane
// drawn on a square grid points visibly wrong. Mercator is what every map
// the reader has ever seen uses, so a Dubuque -> Chicago line drawn this way
// matches the angle they remember.
//
// Aspect ratio is preserved. Stretching the points to fill the box would
// make a north-south lane and an east-west lane look the same length, which
// is precisely the comparison the map exists to support.
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180

// The Mercator y for a latitude, in the same units as longitude, so the two
// can be scaled together. Clamped either side of the poles, where the
// function runs away to infinity -- no freight goes there, but a null island
// coordinate of (0, 0) or a typo should not produce NaN geometry.
export function mercatorY(latitude) {
  const lat = Math.max(-85, Math.min(85, Number(latitude)))
  return (Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2)) / DEG)
}

// Mercator, run backwards: the latitude a projected y stands for. Only used
// to say which slice of the world a box is showing, which is how the
// geography behind the map is cut down to the lines that can be seen.
export function latitudeAt(y) {
  return (2 * Math.atan(Math.exp(Number(y) * DEG)) - Math.PI / 2) / DEG
}

// A coordinate is usable only if it is actually a number. Number(null) is 0
// and Number('') is 0, both finite, both in the Atlantic off Africa -- so
// the empty cases have to be refused before the conversion, not after it.
export function isPlaceable(p) {
  if (!p) return false
  for (const v of [p.latitude, p.longitude]) {
    if (v === null || v === undefined || v === '') return false
    if (!Number.isFinite(Number(v))) return false
  }
  return true
}

// The smallest span the map will zoom to, in degrees. Two docks in one city
// are a hundredth of a degree apart; without a floor the map would zoom to
// the gap between them and the reader would see two pins and no context.
const MIN_SPAN = 1.6

// points -> the same points with x and y in the box, plus the scale used.
// Anything without usable coordinates is dropped, not plotted at the origin.
//
// `fitTo` says which points the zoom is chosen for; everything else is drawn
// at whatever position that zoom gives it, off the edge if that is where it
// falls. Without it the map fits its own background: a dozen reference
// cities spread across five states would squeeze the three stops the reader
// came for into a knot in the middle.
//
// `fitSlack` widens the fitted span before the zoom is chosen -- 1.4 shows
// forty per cent more world than the stops strictly need. A map zoomed
// exactly to its subject has no context at the edges, and context is the
// entire job of the cities drawn behind it.
export function layout(points, {
  width = 640, height = 360, padding = 28, fitTo = null, fitSlack = 1,
} = {}) {
  const usable = (points || []).filter(isPlaceable).map((p) => ({
    ...p,
    _x: Number(p.longitude),
    _y: mercatorY(p.latitude),
  }))

  const inner = { w: Math.max(1, width - padding * 2), h: Math.max(1, height - padding * 2) }
  if (usable.length === 0) {
    // No points means no zoom was ever chosen, so there is no honest way to
    // place anything else either. `project` and `view` are null rather than
    // some default centred on nowhere, which would silently draw geography
    // in the wrong place instead of drawing none.
    return { width, height, padding, scale: 1, points: [], project: null, view: null }
  }

  const fitPoints = typeof fitTo === 'function'
    ? usable.filter(fitTo)
    : usable
  const fit = fitPoints.length > 0 ? fitPoints : usable

  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity
  for (const p of fit) {
    if (p._x < minX) minX = p._x
    if (p._x > maxX) maxX = p._x
    if (p._y < minY) minY = p._y
    if (p._y > maxY) maxY = p._y
  }

  // Grow whichever span is too small, around its own centre, so a single
  // point or a tight cluster lands in the middle at a sane zoom.
  const slack = Math.max(1, Number(fitSlack) || 1)
  const spanX = Math.max((maxX - minX) * slack, MIN_SPAN)
  const spanY = Math.max((maxY - minY) * slack, MIN_SPAN)
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2

  // One scale for both axes: the map keeps its shape.
  const scale = Math.min(inner.w / spanX, inner.h / spanY)

  // The same arithmetic the points get, handed back so that anything else
  // drawn on this map -- a state border, say -- lands in the same places.
  // A separate copy of these two lines somewhere else is a map that agrees
  // with itself until one of them is edited.
  const project = (longitude, latitude) => ({
    x: width / 2 + (Number(longitude) - midX) * scale,
    // SVG y grows downward and north is up, so this one is negated.
    y: height / 2 - (mercatorY(latitude) - midY) * scale,
  })

  // Which slice of the world the box is showing, in plain degrees. The box
  // is `width` wide at `scale` pixels per degree, so half of it either side
  // of the centre; north and south come back through Mercator because the
  // projection is only linear in longitude.
  const view = {
    west: midX - (width / 2) / scale,
    east: midX + (width / 2) / scale,
    south: latitudeAt(midY - (height / 2) / scale),
    north: latitudeAt(midY + (height / 2) / scale),
  }

  return {
    width,
    height,
    padding,
    scale,
    project,
    view,
    points: usable.map((p) => ({ ...p, ...project(p.longitude, p.latitude) })),
  }
}

// Great-circle distance in statute miles. Only used to label a lane, so the
// spherical approximation is far more precision than the label shows.
export function milesBetween(a, b) {
  if (!isPlaceable(a) || !isPlaceable(b)) return null
  const R = 3958.8
  const dLat = (b.latitude - a.latitude) * DEG
  const dLon = (b.longitude - a.longitude) * DEG
  const lat1 = a.latitude * DEG
  const lat2 = b.latitude * DEG
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

// ---------------------------------------------------------------------------
// The geography behind the map.
//
// src/lib/stateOutlines.js holds the state borders as flat arrays of
// [lon, lat, lon, lat, ...] -- ten thousand points, so a pair of brackets
// around each one would be a third of the file. These two functions are
// everything the map does with them: throw away the ones it cannot see, and
// turn the rest into path data.
// ---------------------------------------------------------------------------

// Does any part of this line's bounding box fall inside the view? A line
// lies entirely within its own box, so a box that misses the view cannot
// have a visible point OR a segment crossing the middle -- the test is
// conservative in the safe direction, keeping a few lines that turn out to
// be just off the edge and never dropping one that shows.
export function borderInView(line, view, margin = 0) {
  if (!view || !line || line.length < 4) return false
  let west = Infinity; let east = -Infinity; let south = Infinity; let north = -Infinity
  for (let i = 0; i + 1 < line.length; i += 2) {
    const lon = line[i]
    const lat = line[i + 1]
    if (lon < west) west = lon
    if (lon > east) east = lon
    if (lat < south) south = lat
    if (lat > north) north = lat
  }
  return (
    east >= view.west - margin && west <= view.east + margin
    && north >= view.south - margin && south <= view.north + margin
  )
}

export function bordersInView(lines, view, { margin = 0 } = {}) {
  if (!view || !Array.isArray(lines)) return []
  return lines.filter((line) => borderInView(line, view, margin))
}

// One line as SVG path data. Coordinates are rounded to a tenth of a pixel:
// nobody can see the difference and it is a quarter of the characters. A
// point that does not project to a finite pair -- which should not happen,
// but the file is generated -- ends the line rather than poisoning it with
// a NaN, because one NaN makes the browser drop the whole path.
export function borderPath(line, project) {
  if (!line || typeof project !== 'function') return ''
  const parts = []
  for (let i = 0; i + 1 < line.length; i += 2) {
    const { x, y } = project(line[i], line[i + 1])
    if (!Number.isFinite(x) || !Number.isFinite(y)) break
    parts.push(`${parts.length === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
  }
  return parts.length > 1 ? parts.join(' ') : ''
}
