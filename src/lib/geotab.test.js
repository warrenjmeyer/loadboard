// node --test
//
// The link into MyGeotab is a string built from a load, and the string has to
// match a route name created months earlier by geotab-add-routes.ps1. Nothing
// checks that at runtime -- a wrong name is a link that quietly finds nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routeNameFor, geotabRouteUrl } from './geotab.js'

const LOAD = { origin: 'Dubuque, IA', destination: 'Chicago, IL' }

test('the route name is upper-cased, matching what the scripts created', () => {
  // The load board stores "Dubuque, IA" and the settlements "DUBUQUE, IA".
  // Get-Lanes upper-cases both before creating anything, so the route in
  // Geotab is upper-case and only an upper-case search finds it.
  assert.equal(routeNameFor(LOAD), 'DUBUQUE, IA - CHICAGO, IL')
})

test('the separator is space-dash-space, as the route names use', () => {
  assert.match(routeNameFor(LOAD), / - /)
})

test('spaces are escaped and the fragment punctuation is left alone', () => {
  // This exact URL was confirmed against demo_millstream: it returns one row.
  // encodeURIComponent would escape the commas and quotes as well, and the
  // search would match nothing at all.
  assert.equal(
    geotabRouteUrl(LOAD),
    "https://my.geotab.com/demo_millstream/#routes,search:'DUBUQUE,%20IA%20-%20CHICAGO,%20IL'"
  )
})

test('a load with no lane produces no link rather than a broken one', () => {
  // deliveredDate and driverCode are nulled for anonymous callers, but origin
  // and destination never are -- so this is defensive. A link built from
  // "undefined - undefined" would look real and go nowhere.
  assert.equal(routeNameFor({ origin: 'Dubuque, IA' }), null)
  assert.equal(geotabRouteUrl({}), null)
  assert.equal(geotabRouteUrl(null), null)
})
