// ---------------------------------------------------------------------------
// Ask HERE for a route WITH a driver's hours in it, and see what comes back.
//
//   $env:HERE_API_KEY = '...'
//   node tools/here-hos-probe.mjs
//
// THE QUESTION THIS ANSWERS, and why it has to be asked before any code is
// written against it. `driver[schedule]` makes the router insert rest stops
// to obey hours-of-service. The specification says it "adds necessary stops
// for rest" -- which means the route comes back with MORE SECTIONS THAN THE
// LOAD HAS STOPS, and api/src/etaRules.js currently pairs section i with
// stop i. Left alone, that would hang an arrival time on the wrong dock: a
// number that looks entirely reasonable and is about somewhere else.
//
// So this prints, for every section: where it departs and arrives, whether
// that place carries a `waypoint` index (a real stop of ours) or does not (a
// rest the router invented), and any postActions or notices attached. That is
// exactly what the grouping code has to key on.
//
// The lane is Las Vegas to Salt Lake City -- about eight hours, long enough
// that an eleven-hour clock does not force a rest but a nearly-empty one
// does. Both are asked for, so the difference is visible side by side.
// ---------------------------------------------------------------------------
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const KEY = process.env.HERE_API_KEY
if (!KEY) {
  console.error("Set HERE_API_KEY first:  $env:HERE_API_KEY = '...'")
  process.exit(1)
}

const here = dirname(fileURLToPath(import.meta.url))
const out = (name) => resolve(here, '..', name)

const LAS_VEGAS = { lat: 36.1699, lng: -115.1398 }
const ST_GEORGE = { lat: 37.0965, lng: -113.5684 }
const SALT_LAKE = { lat: 40.7608, lng: -111.8910 }

const HOURS = 3600

// Three schedules, in the format HERE wants: pairs of
// driveDuration,restDuration in seconds.
const SCHEDULES = {
  'none (today)': null,
  // A driver who has just come on: the full US property-carrying picture,
  // eleven hours of driving then ten off, repeated.
  'fresh: 11h drive / 10h rest': `${11 * HOURS},${10 * HOURS},${11 * HOURS},${10 * HOURS}`,
  // A driver with forty minutes left before they must shut down. This is the
  // case that makes an honest ETA differ from a naive one -- and the case the
  // demo fleet is actually in.
  'nearly out: 40m then 10h rest': `${40 * 60},${10 * HOURS},${11 * HOURS},${10 * HOURS}`,
}

function url(schedule) {
  const p = new URLSearchParams()
  p.set('transportMode', 'truck')
  p.set('origin', `${LAS_VEGAS.lat},${LAS_VEGAS.lng}`)
  p.set('destination', `${SALT_LAKE.lat},${SALT_LAKE.lng}`)
  p.append('via', `${ST_GEORGE.lat},${ST_GEORGE.lng}`)
  p.set('return', 'summary')
  p.set('truck[grossWeight]', '36287')
  p.set('truck[height]', '412')
  p.set('truck[axleCount]', '5')
  if (schedule) p.set('driver[schedule]', schedule)
  p.set('apikey', KEY)
  return `https://router.hereapi.com/v8/routes?${p.toString()}`
}

const hhmm = (s) => `${Math.floor(s / 3600)}h${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`

for (const [label, schedule] of Object.entries(SCHEDULES)) {
  console.log(`\n=== ${label}`)
  if (schedule) console.log(`    driver[schedule]=${schedule}`)
  let res
  try {
    res = await fetch(url(schedule), { signal: AbortSignal.timeout(25000) })
  } catch (err) {
    console.log(`  request failed: ${err.message}`)
    continue
  }
  const text = await res.text()
  if (!res.ok) {
    console.log(`  HTTP ${res.status}  ${text.slice(0, 300)}`)
    continue
  }
  writeFileSync(out(`here-hos-${label.split(':')[0].replace(/[^a-z]/gi, '') || 'none'}.json`), text)

  const body = JSON.parse(text)
  const sections = (body.routes && body.routes[0] && body.routes[0].sections) || []
  console.log(`  HTTP ${res.status}, ${sections.length} sections (the load has 3 stops = 2 real legs)`)
  let total = 0
  sections.forEach((s, i) => {
    const dur = (s.summary && s.summary.duration) || 0
    total += dur
    // THE FIELD THAT MATTERS: a section that ends at one of OUR stops should
    // carry a waypoint index; one that ends at a rest the router invented
    // should not.
    const arrivalWaypoint = s.arrival && s.arrival.place && s.arrival.place.waypoint
    const departureWaypoint = s.departure && s.departure.place && s.departure.place.waypoint
    console.log(`   ${i + 1}. ${hhmm(dur)}  depart ${s.departure && s.departure.time}  arrive ${s.arrival && s.arrival.time}`)
    console.log(`      waypoint: departure=${departureWaypoint ?? '-'} arrival=${arrivalWaypoint ?? '-'}`
      + `  arrivalPlaceType=${s.arrival && s.arrival.place && s.arrival.place.type}`)
    if (s.postActions && s.postActions.length) {
      console.log(`      postActions: ${s.postActions.map((a) => `${a.action}(${a.duration ?? '?'}s)`).join(', ')}`)
    }
    if (s.preActions && s.preActions.length) {
      console.log(`      preActions:  ${s.preActions.map((a) => `${a.action}(${a.duration ?? '?'}s)`).join(', ')}`)
    }
    if (s.notices && s.notices.length) {
      console.log(`      notices: ${s.notices.map((n) => `${n.code}/${n.severity}`).join(', ')}`)
    }
  })
  console.log(`  driving total: ${hhmm(total)}`)
  const first = sections[0]
  const last = sections[sections.length - 1]
  if (first && last && first.departure && last.arrival) {
    const elapsed = (Date.parse(last.arrival.time) - Date.parse(first.departure.time)) / 1000
    console.log(`  elapsed door to door: ${hhmm(elapsed)}  <- driving PLUS rests, which is the number an ETA needs`)
  }
}

console.log('\nThe json files are safe to share -- no credential in any of them.')
