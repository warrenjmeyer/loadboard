import { useState, useEffect } from 'react'
import { layout, milesBetween, isPlaceable, bordersInView, borderPath } from '../lib/mapProject.js'
import { formatMiles } from '../lib/format.js'

// ---------------------------------------------------------------------------
// A load's stops on a map, drawn as SVG, with no map library and no tiles.
//
// WHERE THE COORDINATES COME FROM. Nothing here is geocoded. A stop says
// "WATERLOO, IA" and so does a Geotab Zone -- geotab-add-zones.ps1 drew a
// 3 km box around every city the lanes touch and named it the way the load
// board spells it. GET /api/telematics/zones hands back those boxes'
// centres, and the match is by name, the same join src/lib/geotab.js uses
// to link a load to its MyGeotab route. The map is therefore aligned with
// Geotab by construction: it plots Geotab's own places.
//
// WHAT THE BASEMAP IS. State borders, and behind them the fleet's other
// zones in grey. The borders are a file in this repo, not a service: US
// Census boundaries, public domain, generated into src/lib/stateOutlines.js
// by tools/gen-state-outlines.mjs. So there is still no tile provider, no
// key, no attribution banner and nothing that can begin charging later --
// and, unlike tiles, nothing that can be down. They cost 150 KB, which is
// why they are not in the bundle: the first map to draw fetches them in
// their own chunk and every map after that has them already.
//
// The cities are still what makes it legible. An outline says which state,
// but Dubuque, Chicago, Des Moines and Minneapolis are what tell someone
// who works here where the freight is going.
//
// WHAT IT DOES NOT CLAIM. The line between stops is straight, and labelled
// as the crow flies, because there is no routing engine here -- a road
// distance needs a service that costs money, and drawing a straight line as
// though it were a route would be a lie the reader cannot see. The pins are
// city centres, not docks: a 3 km box is a town. Both are why this is a
// state-scale picture and not a street map.
// ---------------------------------------------------------------------------
const W = 640
const H = 360

// A driver's own page draws the same map shorter and with less around it:
// it sits in a card they are about to tap through, so it answers "roughly
// where am I going" and leaves the detail to the load page.
const COMPACT_H = 230
const COMPACT_REFS = 8

// The borders, fetched the first time a map draws rather than shipped to
// everyone. They are 150 KB of coordinates -- a third again of everything
// else this app sends -- and most visitors never open a load.
//
// `import()` returns a promise for a module, and Vite gives anything behind
// one its own hashed file. Held at module level, not in state, so the
// second map on a page has them already and a page with ten maps fetches
// once. The map draws without them and redraws with them a moment later;
// nothing spins, and if the fetch fails the map is simply the one that
// shipped last week. That is not worth an error message.
let borderCache = null
function useStateBorders(enabled) {
  const [borders, setBorders] = useState(borderCache)
  useEffect(() => {
    // `enabled` is false while there is no map to draw -- GeoTab not
    // connected, zones still loading, no place matched. Fetching a country
    // for a picture that is not going to appear is the one case where this
    // costs somebody 150 KB for nothing.
    if (!enabled || borderCache) return undefined
    let alive = true
    import('../lib/stateOutlines.js')
      .then((module) => {
        borderCache = module.STATE_BORDERS
        if (alive) setBorders(borderCache)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [enabled])
  return borders
}

export default function LaneMap({
  stops = [],
  zonesByKey = null,
  truck = null,
  notConnected = false,
  error = null,
  loading = false,
  compact = false,
  caption = null,
  borders = null,
}) {
  // Before the early returns below, because a hook that is sometimes called
  // is a hook that breaks the next render -- so the decision not to fetch
  // goes to the hook as an argument rather than being made by not calling
  // it. `borders` as a prop is for tests and for render.check, which never
  // runs an effect.
  const fetched = useStateBorders(!borders && !notConnected && !error && !loading && Boolean(zonesByKey))
  const geography = borders || fetched
  // In a card, a line of apology for something the reader did not ask for is
  // worse than nothing at all. The load page says all of this properly.
  if (notConnected || error) {
    return compact ? null : (notConnected
      ? <p className="muted small">GeoTab is not connected, so there is no map for this load.</p>
      : <p className="error">Could not read the map places from GeoTab: {error}</p>)
  }
  if (loading || !zonesByKey) return compact ? null : <p className="muted small">Drawing the map...</p>

  // A stop becomes a point only if Geotab knows a place of that name.
  const placed = []
  const missing = []
  for (const s of stops) {
    const zone = zonesByKey.get(String(s.place || '').trim().replace(/\s+/g, ' ').toUpperCase())
    if (zone) placed.push({ ...s, latitude: zone.latitude, longitude: zone.longitude, kind: 'stop' })
    else missing.push(s)
  }

  if (placed.length === 0) {
    if (compact) return null
    return (
      <p className="muted small">
        None of this load&apos;s places match a GeoTab zone, so there is nothing to draw.
        {missing.length > 0 && <> Unknown to GeoTab: {missing.map((s) => s.place).join(', ')}.</>}
      </p>
    )
  }

  // The truck is drawn only when it is in the same part of the world. The
  // demo fleet runs around Las Vegas while the freight runs the Midwest, and
  // a map fitted to both is a map of the United States with two specks on
  // it -- worse than either picture alone. Eight degrees is about 550 miles.
  const truckPlaceable = isPlaceable(truck)
  const nearLane = truckPlaceable && placed.some((p) => (
    Math.abs(p.latitude - truck.latitude) < 8 && Math.abs(p.longitude - truck.longitude) < 8
  ))

  const drawn = [...placed]
  if (nearLane) drawn.push({ ...truck, kind: 'truck' })

  // Reference cities: every other zone close enough to the lane to give the
  // eye something to hold on to, at most a dozen, nearest first.
  const laneMid = {
    latitude: placed.reduce((t, p) => t + p.latitude, 0) / placed.length,
    longitude: placed.reduce((t, p) => t + p.longitude, 0) / placed.length,
  }
  const onLane = new Set(placed.map((p) => p.latitude.toFixed(3) + ',' + p.longitude.toFixed(3)))
  const reference = [...zonesByKey.values()]
    .filter((z) => !onLane.has(z.latitude.toFixed(3) + ',' + z.longitude.toFixed(3)))
    .map((z) => ({ ...z, kind: 'ref', away: milesBetween(laneMid, z) }))
    .sort((a, b) => a.away - b.away)
    .slice(0, compact ? COMPACT_REFS : 14)

  // The zoom is chosen for the stops and the truck. Reference cities land
  // where they land; one that falls off the edge is simply off the map, the
  // way a city off the edge of any map is.
  const height = compact ? COMPACT_H : H
  const { points, project, view } = layout([...drawn, ...reference], {
    width: W, height, padding: 30, fitSlack: 1.45, fitTo: (p) => p.kind !== 'ref',
  })

  // Of four hundred border lines, a Midwest lane can see about twenty. The
  // rest are thrown away before any path data is built for them -- cheaper
  // than handing the browser the whole country and letting it clip.
  const borderPaths = geography
    ? bordersInView(geography, view).map((line) => borderPath(line, project)).filter(Boolean)
    : []
  const stopPts = points.filter((p) => p.kind === 'stop')
  const truckPt = points.find((p) => p.kind === 'truck') || null
  const refPts = points.filter((p) => p.kind === 'ref' && p.x > 4 && p.x < W - 60 && p.y > 12 && p.y < height - 6)
  const lane = stopPts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

  const crow = stopPts.length > 1
    ? placed.slice(1).reduce((t, p, i) => t + milesBetween(placed[i], p), 0)
    : null

  return (
    <div className="lane-map">
      <svg viewBox={`0 0 ${W} ${height}`} className="lane-map-svg" role="img"
        aria-label={`Map of ${placed.map((s) => s.place).join(' to ')}`}>
        <rect x="0" y="0" width={W} height={height} className="lane-map-bg" />

        {/* State borders, under everything. Drawn by index because they are
            geometry, not records: there is nothing about line 37 that
            outlives this render. */}
        {borderPaths.map((d, i) => (
          <path key={`border-${i}`} d={d} className="lane-border" />
        ))}

        {/* The rest of the fleet's places, for context only. */}
        {refPts.map((p) => (
          <g key={`ref-${p.key}`} className="lane-ref">
            <circle cx={p.x} cy={p.y} r="2.5" />
            <text x={p.x + 6} y={p.y + 3}>{titleCase(p.name)}</text>
          </g>
        ))}

        {stopPts.length > 1 && <polyline points={lane} className="lane-line" />}

        {truckPt && (
          <g className="lane-truck">
            <circle cx={truckPt.x} cy={truckPt.y} r="7" className="lane-truck-halo" />
            <circle cx={truckPt.x} cy={truckPt.y} r="4" />
            {/* The unit number and nothing else. Below the marker, while
                stop names sit above theirs, so the truck and the dock it is
                sitting at -- which is where a truck usually is -- do not
                write over each other. The town it is near is a dozen
                characters wide and would span both neighbouring pins, so it
                goes in the caption, where there is room for it. */}
            <text x={truckPt.x} y={truckPt.y + 21}>{truck.unitNo}</text>
          </g>
        )}

        {stopPts.map((p, i) => (
          <g key={p.stopId ?? `${p.place}-${i}`} className={`lane-stop lane-stop-${p.stopType === 'Pickup' ? 'pickup' : 'delivery'}${p.departedUtc ? ' lane-stop-done' : ''}`}>
            <circle cx={p.x} cy={p.y} r="11" />
            <text x={p.x} y={p.y + 4} className="lane-stop-seq">{p.seq}</text>
            <text x={p.x} y={p.y - 16} className="lane-stop-label">{p.place}</text>
          </g>
        ))}
      </svg>

      <p className="muted small lane-map-note">
        {caption || <>Places are GeoTab zones, centred on the town — not the dock.</>}
        {crow ? <> The line is {formatMiles(Math.round(crow))} miles as the crow flies, not a route.</> : null}
        {missing.length > 0 && <> No GeoTab zone for {missing.map((s) => s.place).join(', ')}, so {missing.length === 1 ? 'it is' : 'they are'} not shown.</>}
        {truckPt && truck.near && <> {truck.unitNo} last reported near {truck.near}.</>}
        {truckPlaceable && !nearLane && (
          <> {truck.unitNo} is reported {truck.near ? `near ${truck.near}` : 'far from this lane'}, too far away to draw on the same map.</>
        )}
      </p>
    </div>
  )
}

// Zone names are stored upper-case because that is how Geotab's routes and
// the load board's lane strings are written. Shouting them on a map makes
// the reference cities compete with the stops, so they are set back down.
function titleCase(name) {
  return String(name || '').replace(/[^\s,]+/g, (w) => (
    w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()
  ))
}
