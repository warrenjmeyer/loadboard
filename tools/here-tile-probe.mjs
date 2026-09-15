// ---------------------------------------------------------------------------
// Ask HERE for one map tile, and write down what comes back.
//
//   $env:HERE_API_KEY = '...'
//   node tools/here-tile-probe.mjs
//
// Same reason tools/here-probe.mjs exists: Azure will not read an app setting
// back, so the only person who can make a live HERE call from a laptop is
// whoever holds the key. This one answers the questions the routing probe
// did not:
//
//   1. Does this account's plan include RASTER TILES at all, or only routing?
//   2. Which styles does it actually have? The API says "see /info" rather
//      than listing them, and some styles -- the logistics ones that draw
//      truck restrictions -- are billed as ADVANCED rather than base. Worth
//      knowing which is which before putting one behind every load.
//   3. What does a tile of Dubuque weigh, and does it look like a map?
//
// It writes the tile to here-tile-<style>.png so it can be looked at. That
// file is gitignored, contains no credential, and is a picture of a town.
//
// BILLING NOTE, the reason the app does not just turn tiles on: with the
// Raster Tile API each tile request is one transaction. A map view is four
// to six tiles at 512 px, so a basemap costs several times what an ETA
// does, every view. This script requests ONE tile per style.
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

// Dubuque, on the Mississippi, at a zoom that shows a town and its roads.
const LAT = 42.5006
const LON = -90.6646
const ZOOM = 11

// The standard slippy-map arithmetic: the world is 2^zoom tiles across, x is
// linear in longitude and y is linear in MERCATOR latitude. This is the same
// projection src/lib/mapProject.js already uses, which is why tiles can sit
// under the existing pins without a map library.
function tileFor(lat, lon, z) {
  const n = 2 ** z
  const x = Math.floor(((lon + 180) / 360) * n)
  const rad = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n)
  return { x, y }
}

const redact = (u) => u.replace(/apiKey=[^&]*/, 'apiKey=***')

// ---------------------------------------------------------------------------
// 1. What this account is allowed to ask for.
// ---------------------------------------------------------------------------
console.log('=== /v3/info')
let info = null
try {
  const res = await fetch(`https://maps.hereapi.com/v3/info?apiKey=${encodeURIComponent(KEY)}`, {
    signal: AbortSignal.timeout(20000),
  })
  const text = await res.text()
  console.log(`  HTTP ${res.status}`)
  if (res.ok) {
    info = JSON.parse(text)
    writeFileSync(out('here-tile-info.json'), text)
    console.log('  written to here-tile-info.json')
    const styles = (info.formats || info.styles || [])
    console.log(`  resources: ${(info.resources || []).map((r) => r.resource || r).join(', ') || '(see json)'}`)
    console.log(`  styles:    ${Array.isArray(styles) ? styles.join(', ') : JSON.stringify(styles).slice(0, 300)}`)
  } else {
    // A 401 here means the key is wrong; a 403 means the plan has no tiles,
    // which is the answer that stops this feature dead.
    console.log(`  ${text.slice(0, 300)}`)
  }
} catch (err) {
  console.log(`  request failed: ${err.message}`)
}

// ---------------------------------------------------------------------------
// 2. One actual tile, per style worth trying.
//
// explore.day is the default and the ordinary street map. lite.day is the
// quiet one, which is what a map with pins and a lane drawn on top wants:
// fewer labels to fight with. logistics.day is included ONLY to see whether
// the account has it -- it draws truck restrictions, and it is the one that
// bills as Advanced, so knowing is worth exactly one transaction.
// ---------------------------------------------------------------------------
const { x, y } = tileFor(LAT, LON, ZOOM)
console.log(`\n=== tiles for Dubuque at z${ZOOM} (x=${x}, y=${y})`)

for (const style of ['explore.day', 'lite.day', 'logistics.day']) {
  const url = `https://maps.hereapi.com/v3/base/mc/${ZOOM}/${x}/${y}/png8`
    + `?style=${style}&size=512&ppi=100&apiKey=${encodeURIComponent(KEY)}`
  process.stdout.write(`  ${style.padEnd(15)} `)
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
    const type = res.headers.get('content-type') || ''
    if (!res.ok) {
      const body = await res.text()
      console.log(`HTTP ${res.status}  ${body.slice(0, 160)}`)
      continue
    }
    const bytes = Buffer.from(await res.arrayBuffer())
    const file = out(`here-tile-${style}.png`)
    writeFileSync(file, bytes)
    console.log(`HTTP ${res.status}  ${type}  ${(bytes.length / 1024).toFixed(0)} KB  -> ${file}`)
  } catch (err) {
    console.log(`request failed: ${err.message}`)
  }
}

console.log(`\nExample URL shape (key redacted):\n  ${redact(`https://maps.hereapi.com/v3/base/mc/${ZOOM}/${x}/${y}/png8?style=lite.day&size=512&ppi=100&apiKey=${KEY}`)}`)
console.log('\nThe png and json files are safe to share -- no credential in any of them.')
