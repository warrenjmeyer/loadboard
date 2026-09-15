// ---------------------------------------------------------------------------
// Ask HERE for one real route and write down what comes back.
//
//   $env:HERE_API_KEY = '...'
//   node tools/here-probe.mjs
//
// WHY THIS EXISTS. Azure redacts application settings, so the key cannot be
// read back out of the Static Web App -- which means the only person who can
// make a live HERE call from a laptop is whoever holds the key. This script
// is what they run. It prints a summary, writes the full JSON beside itself,
// and NEVER prints the key.
//
// It answers the question that decides whether HERE is worth using at all:
// is `transportMode=truck` included in this account's plan, or only `car`?
// A truck-legal route is the thing no free router does. So it asks for both
// and reports which ones the account is actually allowed to have.
//
// The lane is a real one off the load board -- Waterloo to Dubuque to
// Minneapolis -- because a route through three stops is what the ETA needs,
// and a two-point route would not show how sections line up with stops.
// ---------------------------------------------------------------------------
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const KEY = process.env.HERE_API_KEY
if (!KEY) {
  console.error('Set HERE_API_KEY first:  $env:HERE_API_KEY = \'...\'')
  process.exit(1)
}

// Geotab's zone centres for three towns on one load, in stop order.
const STOPS = [
  { place: 'WATERLOO, IA', lat: 42.4928, lng: -92.3426 },
  { place: 'DUBUQUE, IA', lat: 42.5006, lng: -90.6646 },
  { place: 'MINNEAPOLIS, MN', lat: 44.9778, lng: -93.2650 },
]

const here = dirname(fileURLToPath(import.meta.url))

function url(mode) {
  const p = new URLSearchParams()
  p.set('transportMode', mode)
  p.set('origin', `${STOPS[0].lat},${STOPS[0].lng}`)
  p.set('destination', `${STOPS[STOPS.length - 1].lat},${STOPS[STOPS.length - 1].lng}`)
  p.set('return', 'summary')
  p.set('apikey', KEY)
  // Via waypoints repeat, in order. URLSearchParams keeps the order it is
  // given, and `append` is how the same name goes in twice.
  for (const s of STOPS.slice(1, -1)) p.append('via', `${s.lat},${s.lng}`)
  // A truck this size is the point of asking HERE rather than a free router:
  // 80,000 lb and 13'6" is a legal US tractor-trailer, and the restrictions
  // that follow from it are what a car route cannot know about.
  if (mode === 'truck') {
    p.set('truck[grossWeight]', '36287')   // kg, 80,000 lb
    p.set('truck[height]', '412')          // cm, 13 ft 6 in
    p.set('truck[width]', '259')           // cm, 8 ft 6 in
    p.set('truck[length]', '2200')         // cm, 72 ft
    p.set('truck[axleCount]', '5')
  }
  return `https://router.hereapi.com/v8/routes?${p.toString()}`
}

const hhmm = (s) => `${Math.floor(s / 3600)}h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')}m`

for (const mode of ['truck', 'car']) {
  process.stdout.write(`\n=== transportMode=${mode}\n`)
  let res
  try {
    res = await fetch(url(mode), { signal: AbortSignal.timeout(20000) })
  } catch (err) {
    console.log(`  request failed: ${err.message}`)
    continue
  }
  const text = await res.text()
  let body = null
  try { body = JSON.parse(text) } catch { /* not JSON */ }

  console.log(`  HTTP ${res.status}`)
  const out = resolve(here, '..', `here-probe-${mode}.json`)
  writeFileSync(out, text)
  console.log(`  full response written to ${out}`)

  if (!res.ok) {
    // The interesting failure. 403 here usually means "your plan does not
    // include that", which is exactly what we are trying to find out.
    console.log(`  error: ${body ? JSON.stringify(body).slice(0, 400) : text.slice(0, 400)}`)
    continue
  }

  const route = body && body.routes && body.routes[0]
  if (!route) { console.log('  no route in the answer'); continue }
  console.log(`  ${route.sections.length} sections (one per leg between stops)`)
  let total = 0
  route.sections.forEach((s, i) => {
    const d = (s.summary && s.summary.duration) || 0
    const m = (s.summary && s.summary.length) || 0
    total += d
    console.log(`    ${i + 1}. ${STOPS[i].place} -> ${STOPS[i + 1].place}`)
    console.log(`       depart ${s.departure && s.departure.time}  arrive ${s.arrival && s.arrival.time}`)
    console.log(`       ${hhmm(d)}, ${Math.round(m / 1609.344)} miles`)
    if (s.notices && s.notices.length) {
      console.log(`       notices: ${s.notices.map((n) => n.code).join(', ')}`)
    }
  })
  console.log(`  total driving: ${hhmm(total)}`)
}

console.log('\nThe two json files are safe to share -- they contain no credential.')
