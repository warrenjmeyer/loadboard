// ---------------------------------------------------------------------------
// The rules of an itinerary, with no database and no HTTP in them.
//
// A load's stops are a list: at least two, the first a Pickup, the last a
// Delivery, in the order they are driven. This file says what a valid list
// looks like, what the load's six summary columns should say given one,
// which stop the driver is at, and whether a check-in is allowed. stops.js
// asks and does the SQL; stopRules.test.js checks every branch.
// ---------------------------------------------------------------------------

const { normaliseDatetime } = require('./loadRules')

const TYPES = ['Pickup', 'Delivery']
const MAX_STOPS = 20

const FIELDS = {
  stopType: { col: 'stop_type', type: 'enum', values: TYPES, required: true, label: 'Stop type' },
  place: { col: 'place', type: 'text', max: 100, required: true, label: 'City, state' },
  name: { col: 'name', type: 'text', max: 100, label: 'Name' },
  address: { col: 'address', type: 'text', max: 200, label: 'Address' },
  phone: { col: 'phone', type: 'text', max: 30, label: 'Phone' },
  windowStart: { col: 'window_start', type: 'datetime', label: 'Window start' },
  windowEnd: { col: 'window_end', type: 'datetime', label: 'Window end' },
  referenceNo: { col: 'reference_no', type: 'text', max: 40, label: 'Reference #' },
  notes: { col: 'notes', type: 'text', max: 400, label: 'Notes' },
}

function checkField(spec, raw, where) {
  const empty = raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')
  if (empty) {
    if (spec.required) return { error: `${where}: ${spec.label.toLowerCase()} is required.` }
    return { value: null }
  }
  switch (spec.type) {
    case 'text': {
      if (typeof raw !== 'string') return { error: `${where}: ${spec.label.toLowerCase()} must be text.` }
      const value = raw.trim()
      if (value.length > spec.max) return { error: `${where}: ${spec.label.toLowerCase()} cannot be longer than ${spec.max} characters.` }
      return { value }
    }
    case 'enum':
      if (!spec.values.includes(raw)) return { error: `${where}: ${spec.label.toLowerCase()} must be ${spec.values.join(' or ')}.` }
      return { value: raw }
    case 'datetime': {
      if (typeof raw !== 'string') return { error: `${where}: ${spec.label.toLowerCase()} must be a date.` }
      const value = normaliseDatetime(raw.trim())
      if (!value) return { error: `${where}: ${spec.label.toLowerCase()} is not a valid date and time.` }
      return { value }
    }
    default:
      return { error: `${where}: ${spec.label} cannot be validated.` }
  }
}

// The whole list, as it arrived from the form. Returns { errors, stops }
// where stops are clean and renumbered 1..n in the order given. Existing
// stops keep their stopId so the route can tell an edit from a replacement
// and keep the arrived / departed times on the ones that survive.
function validateStops(raw) {
  const errors = []
  if (!Array.isArray(raw)) return { errors: ['Stops must be a list.'], stops: [] }
  if (raw.length < 2) errors.push('A load needs at least a pickup and a delivery.')
  if (raw.length > MAX_STOPS) errors.push(`A load cannot have more than ${MAX_STOPS} stops.`)

  const stops = raw.map((r, i) => {
    const where = `Stop ${i + 1}`
    const stop = { seq: i + 1, stopId: Number.isInteger(r?.stopId) && r.stopId > 0 ? r.stopId : null }
    for (const [name, spec] of Object.entries(FIELDS)) {
      const { value, error } = checkField(spec, r ? r[name] : undefined, where)
      if (error) errors.push(error)
      else stop[name] = value
    }
    if (stop.windowStart && stop.windowEnd && stop.windowEnd < stop.windowStart) {
      errors.push(`${where}: the window ends before it starts.`)
    }
    return stop
  })

  if (stops.length >= 2) {
    if (stops[0].stopType && stops[0].stopType !== 'Pickup') errors.push('The first stop must be a pickup.')
    if (stops[stops.length - 1].stopType && stops[stops.length - 1].stopType !== 'Delivery') errors.push('The last stop must be a delivery.')
  }
  return { errors, stops }
}

// The six summary columns on dbo.Loads, from the stops. The first stop is
// the origin and the shipper; the last is the destination and the
// consignee. Keyed by the load FIELDS names so loads.js can bind them the
// way it binds any other edit.
function summaryFrom(stops) {
  if (!stops || stops.length === 0) return {}
  const first = stops[0]
  const last = stops[stops.length - 1]
  return {
    origin: first.place,
    shipperName: first.name || null,
    shipperAddress: first.address || null,
    shipperPhone: first.phone || null,
    pickupStart: first.windowStart || null,
    pickupEnd: first.windowEnd || null,
    destination: last.place,
    consigneeName: last.name || null,
    consigneeAddress: last.address || null,
    consigneePhone: last.phone || null,
    deliveryStart: last.windowStart || null,
    deliveryEnd: last.windowEnd || null,
  }
}

// The reverse: the two stops a load's six columns describe. What a POST
// with no stops list gets, and what the migration seeded.
function stopsFromSummary(load) {
  return [
    { seq: 1, stopType: 'Pickup', place: load.origin, name: load.shipperName || null, address: load.shipperAddress || null,
      phone: load.shipperPhone || null, windowStart: load.pickupStart || null, windowEnd: load.pickupEnd || null, referenceNo: null, notes: null },
    { seq: 2, stopType: 'Delivery', place: load.destination, name: load.consigneeName || null, address: load.consigneeAddress || null,
      phone: load.consigneePhone || null, windowStart: load.deliveryStart || null, windowEnd: load.deliveryEnd || null, referenceNo: null, notes: null },
  ]
}

// Where the driver is. The current stop is the first one not departed;
// null once every stop is done.
function progress(stops) {
  const list = stops || []
  const done = list.filter((s) => s.departedUtc).length
  const current = list.find((s) => !s.departedUtc) || null
  return {
    total: list.length,
    done,
    current,
    currentSeq: current ? current.seq : null,
    atDock: Boolean(current && current.arrivedUtc),
    complete: list.length > 0 && done === list.length,
  }
}

// May this person check in at this stop, and what does it do to the load?
//
//   action 'arrive'  the driver is at the dock
//   action 'depart'  loaded or unloaded, rolling
//
// Only the current stop, in order: arriving at stop 3 while stop 2 is still
// open is a mistake somewhere, and "call dispatch" is the right answer for
// it. Departing the first pickup of a Covered load is what makes it In
// Transit -- the same move the "Picked up" button makes, reached from the
// itinerary instead. Delivered stays an explicit act: departing the last
// stop says "done here", not "paid".
function planCheckIn(load, stops, stopId, action, user, now = new Date()) {
  const staff = Boolean(user) && (user.role === 'dispatcher' || user.role === 'admin')
  const own = Boolean(user) && user.role === 'driver' && user.driverCode && load.driverCode
    && user.driverCode.toUpperCase() === load.driverCode.toUpperCase()
  if (!staff && !own) return { errors: ['Only the driver on this load, or dispatch, can check in at a stop.'], forbidden: true }
  if (action !== 'arrive' && action !== 'depart') return { errors: ['Action must be arrive or depart.'] }
  if (load.status !== 'Covered' && load.status !== 'In Transit') {
    return { errors: [`A ${load.status.toLowerCase()} load has no stops to check in at.`] }
  }

  const stop = (stops || []).find((s) => s.stopId === stopId)
  if (!stop) return { errors: ['No such stop on this load.'], notFound: true }
  const p = progress(stops)
  if (!p.current || p.current.stopId !== stopId) {
    return { errors: [stop.departedUtc ? 'That stop is already done.' : `Stop ${p.currentSeq} comes first.`] }
  }
  if (action === 'arrive' && stop.arrivedUtc) return { errors: ['Already arrived at that stop.'] }
  if (action === 'depart' && !stop.arrivedUtc) return { errors: ['Arrive before departing.'] }

  const at = now.toISOString().slice(0, 19)
  const label = `${stop.stopType.toLowerCase()} ${stop.seq} of ${p.total}, ${stop.place}`
  const events = [{
    type: action === 'arrive' ? 'Arrived' : 'Departed',
    detail: action === 'arrive' ? `Arrived at ${label}` : `Departed ${label}`,
  }]
  const next = { arrivedUtc: action === 'arrive' ? at : stop.arrivedUtc, departedUtc: action === 'depart' ? at : null }

  let loadStatus = load.status
  if (action === 'depart' && stop.stopType === 'Pickup' && load.status === 'Covered') {
    loadStatus = 'In Transit'
    events.push({ type: 'Status', fromStatus: 'Covered', toStatus: 'In Transit', detail: null })
  }
  return { errors: [], stop: next, loadStatus, events }
}

// The itinerary an anonymous visitor may see: where and when, not who or
// how to phone them. Same rule as loadRules.PUBLIC_FIELDS.
function publicStop(stop) {
  return {
    stopId: stop.stopId, seq: stop.seq, stopType: stop.stopType, place: stop.place,
    name: null, address: null, phone: null,
    windowStart: stop.windowStart, windowEnd: stop.windowEnd,
    referenceNo: null, notes: null, arrivedUtc: null, departedUtc: null,
  }
}

module.exports = { TYPES, MAX_STOPS, FIELDS, validateStops, summaryFrom, stopsFromSummary, progress, planCheckIn, publicStop }
