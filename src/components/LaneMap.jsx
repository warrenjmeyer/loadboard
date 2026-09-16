import { useState, useEffect } from 'react'
import { layout, milesBetween, isPlaceable, bordersInView, borderPath } from '../lib/mapProject.js'
import { chooseZoom, tilesFor, tileRect, tileUrl } from '../lib/tiles.js'
import { looksLikeTown, labelBox, withoutCollisions } from '../lib/mapLabels.js'
import { formatMiles } from '../lib/format.js'

// ---------------------------------------------------------------------------
// A load's stops on a map, drawn as SVG, with no map library.
//
// WHERE THE COORDINATES COME FROM. Nothing here is geocoded. A stop says
// "WATERLOO, IA" and so does a Geotab Zone -- geotab-add-zones.ps1 drew a
// 3 km box around every city the lanes touch and named it the way the load
// board spells it. GET /api/telematics/zones hands back those boxes'
// centres, and the match is by name, the same join src/lib/geotab.js uses
// to link a load to its MyGeotab route. The map is therefore aligned with
// Geotab by construction: it plots Geotab's own places.
//
// WHAT THE BASEMAP IS, BY DEFAULT. State borders, and behind them the
// fleet's other zones in grey. The borders are a file in this repo, not a
// service: US Census boundaries, public domain, generated into
// src/lib/stateOutlines.js by tools/gen-state-outlines.mjs. Nothing to be
// down, nothing that can begin charging, no attribution banner. They cost
// 150 KB, which is why they are not in the bundle: the first map to draw
// fetches them in their own chunk and every map after that has them
// already.
//
// The cities are still what makes it legible. An outline says which state,
// but Dubuque, Chicago, Des Moines and Minneapolis are what tell someone
// who works here where the freight is going.
//
// STREETS, off by default. Press it and real map tiles from HERE go in
// behind everything, fetched through /api/maptile so the key stays on the
// server. It is a button rather than the default because EACH TILE IS A
// BILLED TRANSACTION -- four to six a view, measured -- and because the
// picture answers its question without one. Off is free and is what this
// map has always looked like.
// When tiles are on the state outlines are hidden: the basemap draws
// borders better than a 1 km-simplified file can, and two sets of the same
// line is just noise.
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

// Whether this reader wants streets, remembered for next time. A per-viewer
// convenience, so localStorage is the right home for it -- nothing here is
// worth a database row, and it must not follow them to another machine.
//
// Read inside an effect rather than at first render: this component is
// server-rendered by render.check, where there is no window, and a value
// that differs between the server's HTML and the browser's first paint is
// the classic hydration mismatch.
const STREETS_KEY = 'loadboard.streets'

function useStreets(enabled) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!enabled) return
    try {
      setOn(window.localStorage.getItem(STREETS_KEY) === '1')
    } catch {
      // Private windows and blocked site data throw on access. A map
      // without a remembered preference is a map; an exception is not.
    }
  }, [enabled])

  const toggle = () => setOn((was) => {
    const next = !was
    try {
      window.localStorage.setItem(STREETS_KEY, next ? '1' : '0')
    } catch { /* see above */ }
    return next
  })

  return [enabled && on, toggle]
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
  streets: streetsOverride = null,
}) {
  // Before the early returns below, because a hook that is sometimes called
  // is a hook that breaks the next render -- so the decision not to fetch
  // goes to the hook as an argument rather than being made by not calling
  // it. `borders` as a prop is for tests and for render.check, which never
  // runs an effect.
  const fetched = useStateBorders(!borders && !notConnected && !error && !loading && Boolean(zonesByKey))
  const geography = borders || fetched

  // Never in a driver's card: it sits inside a link, so a button in it would
  // be a button inside an anchor, and a map in a card that someone scrolls
  // past would spend a dozen transactions nobody asked for.
  const [remembered, toggleStreets] = useStreets(!compact)
  // The prop is for tests and for render.check, which never runs an effect
  // and so could never reach the tiles path on its own.
  const streets = streetsOverride === null ? remembered : Boolean(streetsOverride) && !compact
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
  //
  // NONE OF THEM WHEN STREETS ARE ON. The basemap already names every town
  // in the picture, in a cartographer's positions, and drawing ours over
  // the top gives Sioux City and Cedar Rapids two labels each in two
  // colours a few pixels apart -- which reads as a fault rather than as
  // context. The layer exists to supply what an empty rectangle lacks, so
  // when the rectangle is a map it has nothing left to do. The stops keep
  // their own labels either way: they are the subject, not the background.
  //
  // The zoom does not shift when these disappear, because it was never
  // fitted to them -- see fitTo below.
  const laneMid = {
    latitude: placed.reduce((t, p) => t + p.latitude, 0) / placed.length,
    longitude: placed.reduce((t, p) => t + p.longitude, 0) / placed.length,
  }
  const onLane = new Set(placed.map((p) => p.latitude.toFixed(3) + ',' + p.longitude.toFixed(3)))
  const reference = streets ? [] : [...zonesByKey.values()]
    .filter((z) => !onLane.has(z.latitude.toFixed(3) + ',' + z.longitude.toFixed(3)))
    // Only zones that are named like towns. The fleet's Geotab also holds
    // zones named by street address -- "4200 Mercy Dr, Dubuque, IA 52001,
    // Usa" -- which are real places and say nothing on a map of four
    // states. Filtering before the slice means the nearest fourteen TOWNS
    // get drawn rather than the nearest fourteen zones.
    .filter((z) => looksLikeTown(z.name))
    .map((z) => ({ ...z, kind: 'ref', away: milesBetween(laneMid, z) }))
    .sort((a, b) => a.away - b.away)
    .slice(0, compact ? COMPACT_REFS : 14)

  // The zoom is chosen for the stops and the truck. Reference cities land
  // where they land; one that falls off the edge is simply off the map, the
  // way a city off the edge of any map is.
  const height = compact ? COMPACT_H : H
  const { points, project, view, scale } = layout([...drawn, ...reference], {
    width: W, height, padding: 30, fitSlack: 1.45, fitTo: (p) => p.kind !== 'ref',
  })

  // The basemap, when asked for. The zoom is chosen to match the scale the
  // map is already drawn at, so a tile lands at its own resolution rather
  // than stretched or four times sharper than anyone can see.
  const tiles = streets ? tilesFor(view, chooseZoom(scale)) : []

  // Of four hundred border lines, a Midwest lane can see about twenty. The
  // rest are thrown away before any path data is built for them -- cheaper
  // than handing the browser the whole country and letting it clip.
  const borderPaths = geography
    ? bordersInView(geography, view).map((line) => borderPath(line, project)).filter(Boolean)
    : []
  const stopPts = points.filter((p) => p.kind === 'stop')
  const truckPt = points.find((p) => p.kind === 'truck') || null
  const refPts = points.filter((p) => p.kind === 'ref' && p.x > 4 && p.x < W - 60 && p.y > 12 && p.y < height - 6)

  // What the reader came for goes down first and cannot be written over:
  // the stop names above their pins, and the truck's unit below its own.
  // Then the reference towns, nearest the lane first, and any that would
  // land on something already there is dropped -- dot and all.
  const reserved = [
    ...stopPts.map((p) => labelBox(p.x, p.y - 16, p.place, { anchor: 'middle' })),
    ...(truckPt ? [labelBox(truckPt.x, truckPt.y + 21, truck.unitNo, { anchor: 'middle' })] : []),
  ]
  const refLabels = withoutCollisions(
    refPts.map((p) => ({ ...p, label: titleCase(p.name), box: labelBox(p.x + 6, p.y + 3, titleCase(p.name)) })),
    { reserved },
  )
  const lane = stopPts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

  const crow = stopPts.length > 1
    ? placed.slice(1).reduce((t, p, i) => t + milesBetween(placed[i], p), 0)
    : null

  return (
    <div className="lane-map">
      {/* Off costs nothing and is the map this app has always drawn; on is a
          dozen billed tiles. So the control says which it is rather than
          hiding behind an icon. */}
      {!compact && (
        <div className="lane-map-controls">
          <button
            type="button"
            className={`lane-streets${streets ? ' is-on' : ''}`}
            aria-pressed={streets}
            onClick={toggleStreets}
          >
            Streets
          </button>
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${height}`} className="lane-map-svg" role="img"
        aria-label={`Map of ${placed.map((s) => s.place).join(' to ')}`}>
        <rect x="0" y="0" width={W} height={height} className="lane-map-bg" />

        {/* Tiles first, under everything. Each is placed by the map's own
            project(), so the basemap cannot drift away from the pins on it.
            preserveAspectRatio="none" because the rectangle IS the tile's
            true shape here -- the projection has already done that work. */}
        {tiles.map((t) => {
          const rect = tileRect(t, project)
          return rect ? (
            <image
              key={`${t.z}/${t.x}/${t.y}`}
              href={tileUrl(t)}
              x={rect.x} y={rect.y} width={rect.width} height={rect.height}
              preserveAspectRatio="none"
            />
          ) : null
        })}

        {/* State borders, under everything else but over the tiles -- except
            there are none when tiles are on, because the basemap already
            draws them. Keyed by index because they are geometry, not
            records: there is nothing about line 37 that outlives this
            render. */}
        {!streets && borderPaths.map((d, i) => (
          <path key={`border-${i}`} d={d} className="lane-border" />
        ))}

        {/* The rest of the fleet's places, for context only. */}
        {refLabels.map((p) => (
          <g key={`ref-${p.key}`} className="lane-ref">
            <circle cx={p.x} cy={p.y} r="2.5" />
            <text x={p.x + 6} y={p.y + 3}>{p.label}</text>
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

        {/* HERE's terms require the notice whenever their tiles are shown,
            and it is theirs to be credited for: the roads, the river and the
            state line in the picture are all their survey, not ours. */}
        {streets && (
          <text x={W - 6} y={height - 6} className="lane-attrib" textAnchor="end">© HERE</text>
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
