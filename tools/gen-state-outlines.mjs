// ---------------------------------------------------------------------------
// Generate src/lib/stateOutlines.js -- the state borders drawn behind the
// load map.
//
//   node tools/gen-state-outlines.mjs [states-10m.json]
//
// **Edit this generator, never the file it writes.** Same rule as
// tools/gen_owner_settlements.mjs: the output carries a header saying so.
//
// WHERE THE GEOGRAPHY COMES FROM. The US Census Bureau's cartographic
// boundary files, packaged as TopoJSON by us-atlas. Census data is a work of
// the United States government and is public domain; us-atlas, which is the
// packaging rather than the data, is ISC. So the outlines can simply live in
// this repo -- no key, no tile server, no attribution banner, no request at
// runtime and nothing that can start charging later. Given no argument this
// downloads the source once; the download is not part of the build.
//
// WHY ARCS AND NOT STATES. TopoJSON stores a shared border once and lets
// both states point at it. Iowa and Illinois do not each carry their own
// copy of the Mississippi. Drawing the arcs directly is therefore half the
// data of drawing 50 polygons, and -- the part that shows -- no border is
// stroked twice, which at this line weight would read as a heavier border
// between some states than others. The cost is that the shapes are open
// lines, so nothing here can be filled. The map wants outlines, not a
// coloured land mass, so that cost is not paid for anything.
//
// WHAT IS DROPPED. The five island territories (American Samoa, Guam, the
// Northern Marianas, Puerto Rico, the US Virgin Islands): together they are
// a fifth of the file and this carrier's freight cannot reach them by truck.
// Alaska and Hawaii are KEPT, expensive coastline and all, because "the map
// silently has no geography there" is a bad surprise and an easy one to
// avoid. Nothing else is filtered.
//
// SIMPLIFY. Ramer-Douglas-Peucker at a hundredth of a degree, which is about
// a kilometre, then three decimal places. This map is drawn at state scale:
// at its most zoomed in -- one town, the map's own floor on how far it will
// zoom -- a hundredth of a degree is about four pixels, and at a normal lane
// width it is under two. Detail finer than that is bytes every reader pays
// for and no reader can see. The full-detail file is 11,500 points; this is
// 10,100, and the saving is mostly in the crinkled coastlines, which is
// exactly where 10m detail is wasted on a picture this size.
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const SOURCE = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json'
const EPSILON = 0.01
const PLACES = 3
// FIPS codes for the island territories. Everything else is kept.
const SKIP = new Set(['60', '66', '69', '72', '78'])

const here = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(here, '..', 'src', 'lib', 'stateOutlines.js')

const arg = process.argv[2]
const topology = arg
  ? JSON.parse(readFileSync(arg, 'utf8'))
  : await (await fetch(SOURCE)).json()

// TopoJSON stores coordinates as quantized integer deltas: each point is an
// offset from the one before, and the whole grid is scaled and shifted back
// to degrees by the topology's own transform. Undo both.
const [scaleX, scaleY] = topology.transform.scale
const [translateX, translateY] = topology.transform.translate
function decode(arc) {
  let x = 0
  let y = 0
  return arc.map(([dx, dy]) => {
    x += dx
    y += dy
    return [x * scaleX + translateX, y * scaleY + translateY]
  })
}

// Ramer-Douglas-Peucker: keep the point furthest from the straight line
// between the ends, recurse either side of it, and drop everything that
// never strays more than epsilon. Distances are in degrees, which stretches
// slightly with latitude -- irrelevant at a tolerance chosen by eye.
function simplify(points, epsilon) {
  if (points.length < 3) return points
  const [ax, ay] = points[0]
  const [bx, by] = points[points.length - 1]
  const dx = bx - ax
  const dy = by - ay
  const span = dx * dx + dy * dy

  let worst = -1
  let at = 0
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i]
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

  if (worst <= epsilon) return [points[0], points[points.length - 1]]
  return [
    ...simplify(points.slice(0, at + 1), epsilon).slice(0, -1),
    ...simplify(points.slice(at), epsilon),
  ]
}

// Which arcs the states we are keeping are made of. A geometry's arcs are
// nested as deep as its polygons and holes go, and an index may be negative,
// meaning "that arc, walked backwards" -- ~i is the arc it refers to.
// Direction does not matter to a line that is only ever stroked.
const wanted = new Set()
const collect = (arcs) => {
  if (typeof arcs === 'number') wanted.add(arcs < 0 ? ~arcs : arcs)
  else arcs.forEach(collect)
}
const kept = []
for (const geometry of topology.objects.states.geometries) {
  if (SKIP.has(geometry.id)) continue
  kept.push(geometry.properties.name)
  collect(geometry.arcs)
}

const round = (n) => Number(n.toFixed(PLACES))
let before = 0
let after = 0
const lines = [...wanted].sort((a, b) => a - b).map((index) => {
  const full = decode(topology.arcs[index])
  const thin = simplify(full, EPSILON)
  before += full.length
  after += thin.length
  // Flat [lon, lat, lon, lat, ...]: ten thousand points is twenty thousand
  // numbers, and a pair of brackets around each one is a third of the file.
  return thin.flatMap(([lon, lat]) => [round(lon), round(lat)])
})

const body = lines.map((line) => `[${line.join(',')}]`).join(',\n')
const file = `// GENERATED by tools/gen-state-outlines.mjs -- do not edit by hand.
//
// State borders for the load map, as flat [lon, lat, lon, lat, ...] lines.
// Derived from the US Census Bureau's cartographic boundary files (public
// domain) via us-atlas, simplified to ${EPSILON} degrees and ${PLACES} decimal
// places. ${lines.length} lines, ${after} points, ${kept.length} areas -- the
// 50 states and DC.
//
// Each line is one shared border segment, drawn once: Iowa and Illinois do
// not each carry their own copy of the Mississippi. They are open lines, not
// closed shapes -- strokeable, not fillable. Loaded on demand by LaneMap, so
// nobody who never opens a map downloads this.
export const STATE_BORDERS = [
${body},
]
`

writeFileSync(OUT, file)
console.log(`${OUT}`)
console.log(`  ${kept.length} areas (the 50 states and DC), ${lines.length} border lines`)
console.log(`  ${before} points -> ${after} (epsilon ${EPSILON} deg)`)
console.log(`  ${(file.length / 1024).toFixed(0)} KB on disk`)
