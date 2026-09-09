import test from 'node:test'
import assert from 'node:assert/strict'
import { formatClock, clockClass, formatAge, isStale, compass, geotabMapUrl, mapsUrl } from './hos.js'

test('a clock reads as hours and minutes, and says over when it is', () => {
  assert.equal(formatClock(29700), '8h 15m')
  assert.equal(formatClock(3600), '1h 00m')
  assert.equal(formatClock(540), '9m')
  assert.equal(formatClock(0), '0m')
  assert.equal(formatClock(-1800), '30m over')
  assert.equal(formatClock(null), '—')
})

test('a clock is ok, low under two hours, over at or below zero, unknown when null', () => {
  assert.equal(clockClass(29700), 'clock-ok')
  assert.equal(clockClass(7199), 'clock-low')
  assert.equal(clockClass(0), 'clock-over')
  assert.equal(clockClass(-5), 'clock-over')
  assert.equal(clockClass(null), 'clock-unknown')
})

test('report age is a phrase', () => {
  assert.equal(formatAge(0), 'just now')
  assert.equal(formatAge(12), '12 min ago')
  assert.equal(formatAge(150), '3 h ago')
  assert.equal(formatAge(3000), '2 d ago')
  assert.equal(formatAge(null), null)
})

test('a report over two hours old, or missing, is stale', () => {
  assert.equal(isStale(5), false)
  assert.equal(isStale(120), false)
  assert.equal(isStale(121), true)
  assert.equal(isStale(null), true)
})

test('bearings become compass points', () => {
  assert.equal(compass(0), 'N')
  assert.equal(compass(272), 'W')
  assert.equal(compass(359), 'N')
  assert.equal(compass(135), 'SE')
  assert.equal(compass(null), null)
})

test('the links out are built once, here', () => {
  assert.equal(geotabMapUrl('demo_millstream', 'b5'), 'https://my.geotab.com/demo_millstream/#map,liveVehicleIds:!(b5)')
  assert.equal(geotabMapUrl('demo_millstream', null), null)
  assert.equal(mapsUrl(41.58681, -93.62499), 'https://www.google.com/maps?q=41.58681,-93.62499')
  assert.equal(mapsUrl(null, -93.6), null)
})
