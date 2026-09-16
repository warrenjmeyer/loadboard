// ---------------------------------------------------------------------------
// Thinning a road, without bending it.
//
// HERE returns a route at about a metre's precision -- a few thousand points
// for a day's drive, most of them describing the exact curve of an
// interchange. The map draws that road across six hundred pixels of a
// picture of four states, where a whole interchange is a dot. Sending every
// point would be tens of kilobytes to draw the same line.
//
// So: Ramer-Douglas-Peucker, the same algorithm and the same reasoning as
// tools/gen-state-outlines.mjs uses on the state borders. Keep the point
// furthest from the straight line between the ends, recurse either side of
// it, and drop everything that never strays more than the tolerance. What
// survives is the shape a reader can see; what goes is detail finer than a
// pixel.
//
// Deliberately NOT shared with the outline generator: that runs once on a
// laptop and this runs in a Function on every uncached route. Two copies of
// twenty lines is better than a tools/ import inside api/.
// ---------------------------------------------------------------------------

// About half a kilometre. At the zoom a lane is drawn -- a few hundred miles
// across six hundred units -- that is well under a pixel, and it takes a
// typical interstate route from thousands of points to a couple of hundred.
const DEFAULT_EPSILON = 0.005

function simplify(points, epsilon = DEFAULT_EPSILON) {
  const line = (points || []).filter((p) => (
    Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])
  ))
  if (line.length < 3) return line

  const [ax, ay] = line[0]
  const [bx, by] = line[line.length - 1]
  const dx = bx - ax
  const dy = by - ay
  const span = dx * dx + dy * dy

  let worst = -1
  let at = 0
  for (let i = 1; i < line.length - 1; i += 1) {
    const [px, py] = line[i]
    let distance
    if (span === 0) {
      distance = Math.hypot(px - ax, py - ay)
    } else {
      let t = ((px - ax) * dx + (py - ay) * dy) / span
      t = Math.max(0, Math.min(1, t))
      distance = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
    }
    if (distance > worst) { worst = distance; at = i }
  }

  if (worst <= epsilon) return [line[0], line[line.length - 1]]
  return [
    ...simplify(line.slice(0, at + 1), epsilon).slice(0, -1),
    ...simplify(line.slice(at), epsilon),
  ]
}

// Coordinates rounded to five decimals are a metre; four is ten metres and
// half the characters. A road drawn at state scale does not need either, but
// four is where rounding stops being free and starts being visible on a
// tight lane, so it is where this stops.
function round(points, places = 4) {
  const factor = 10 ** places
  return (points || []).map(([lat, lng]) => [
    Math.round(lat * factor) / factor,
    Math.round(lng * factor) / factor,
  ])
}

module.exports = { simplify, round, DEFAULT_EPSILON }
