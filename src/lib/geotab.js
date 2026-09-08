// ---------------------------------------------------------------------------
// Pointing at the same lane in MyGeotab.
//
// There is NO runtime link between this app and Geotab, and this file does not
// create one. It builds a URL. Nothing here calls Geotab, holds a credential,
// or knows whether the route on the other end exists -- following the link is
// the only thing that finds out, and it needs the reader's own MyGeotab login.
//
// The two systems are tied together by a NAME, not by an id. geotab-add-
// routes.ps1 names every route "ORIGIN - DESTINATION", upper-cased, built from
// the same origin and destination the load carries -- so the route name is a
// function of the load and does not need storing anywhere. That is the whole
// integration, and its one weakness is worth stating: rename a route in
// MyGeotab and this link stops finding it, silently.
//
// On the database name being here in the open: it ships in the JavaScript
// bundle, which anybody can read, so putting the link behind a sign-in does
// NOT hide it. That gate is about relevance -- the link is useless to someone
// with no MyGeotab account -- and not about secrecy. The name is not a
// credential; MyGeotab asks for its own login regardless.
// ---------------------------------------------------------------------------
const GEOTAB_SERVER = 'https://my.geotab.com'
const GEOTAB_DATABASE = 'demo_millstream'

// The route name for a load's lane. Upper-cased because the load board writes
// "Dubuque, IA" and the settlements write "DUBUQUE, IA"; the zones and routes
// were built from the upper-cased form, so anything else finds nothing.
export function routeNameFor(load) {
  if (!load?.origin || !load?.destination) return null
  return `${load.origin} - ${load.destination}`.toUpperCase()
}

// MyGeotab's list pages take a search term in the URL fragment, so this lands
// on the routes list filtered to the one route rather than on a route id we do
// not have. Verified against the live database: the fragment below returns
// exactly one row.
//
// encodeURI and NOT encodeURIComponent. The fragment's own punctuation -- the
// quotes around the term and the comma after "routes" -- is structure that
// Geotab parses; encodeURIComponent would escape the commas inside the lane
// name too and the search would match nothing. encodeURI escapes the spaces
// and leaves the rest, which is exactly the URL the browser produces.
export function geotabRouteUrl(load) {
  const name = routeNameFor(load)
  if (!name) return null
  return encodeURI(`${GEOTAB_SERVER}/${GEOTAB_DATABASE}/#routes,search:'${name}'`)
}
