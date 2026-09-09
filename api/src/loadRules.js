// ---------------------------------------------------------------------------
// The rules of a load, with no database and no HTTP in them.
//
// Which states exist, which moves between them are legal, who may make each
// move, and what a valid field looks like. loads.js asks these questions and
// does the SQL; this file answers them and does nothing else, which is what
// lets loadRules.test.js check every branch without a connection string.
//
// The front end never sees this file. It learns what it may do from the
// `actions` block GET /api/loads/{id} returns, which is computed here for the
// person asking. One copy of the rules, on the side that enforces them.
// ---------------------------------------------------------------------------

const { coverable } = require('./customerRules')

const STATUSES = ['Available', 'Covered', 'In Transit', 'Delivered', 'Cancelled']

// The three the form offers, and the only three in the table. There is no
// CHECK constraint on equipment, so this list IS the rule; without it a typo
// in a client becomes a fourth equipment type on the board forever.
const EQUIPMENT = ['Dry Van', 'Reefer', 'Flatbed']

// Every legal move, for someone allowed to move anything. Backwards moves are
// here on purpose: a load marked delivered by mistake has to be un-deliverable
// without a SQL prompt, and "In Transit" is the only state it can honestly go
// back to. A cancelled load can come back as Available -- the freight was
// re-tendered -- but never straight to Covered, because whoever had been on it
// is not on it any more.
const TRANSITIONS = {
  Available: ['Covered', 'Cancelled'],
  Covered: ['Available', 'In Transit', 'Delivered', 'Cancelled'],
  'In Transit': ['Covered', 'Delivered', 'Cancelled'],
  Delivered: ['In Transit'],
  Cancelled: ['Available'],
}

// What the driver ON the load may do to it: say they picked up, say they
// delivered. Nothing backwards and nothing sideways. A driver who loaded the
// wrong trailer calls dispatch, which is the right answer for that anyway.
const DRIVER_TRANSITIONS = {
  Covered: ['In Transit'],
  'In Transit': ['Delivered'],
}

// ---------------------------------------------------------------------------
// Fields, as data. `col` is the SQL column, `type` picks the validator, and
// the front end's camelCase name is the key. One table, so a field added here
// is validated, written and read without touching three other lists.
//
// `required` applies to a CREATE only. A PATCH validates what it was sent and
// leaves the rest alone -- but it may not blank a required field, which is
// what the check in validateFields enforces.
// ---------------------------------------------------------------------------
const FIELDS = {
  origin: { col: 'origin', type: 'text', max: 100, required: true, label: 'Origin' },
  destination: { col: 'destination', type: 'text', max: 100, required: true, label: 'Destination' },
  miles: { col: 'miles', type: 'int', min: 1, required: true, label: 'Miles' },
  // Deadhead to the pickup. Paid on the settlement, so it lives on the load.
  // Optional on the form; the column is NOT NULL DEFAULT 0, so null here is
  // written as 0 by the API.
  emptyMiles: { col: 'empty_miles', type: 'int', min: 0, label: 'Empty miles' },
  rate: { col: 'rate', type: 'money', min: 0, required: true, label: 'Rate' },
  equipment: { col: 'equipment', type: 'enum', values: EQUIPMENT, required: true, label: 'Equipment' },

  pickupStart: { col: 'pickup_start', type: 'datetime', label: 'Pickup window start' },
  pickupEnd: { col: 'pickup_end', type: 'datetime', label: 'Pickup window end' },
  deliveryStart: { col: 'delivery_start', type: 'datetime', label: 'Delivery window start' },
  deliveryEnd: { col: 'delivery_end', type: 'datetime', label: 'Delivery window end' },

  // The link to dbo.Customers. When it is set the API copies the customer's
  // name into customerName, so the two agree; a load entered before the
  // table existed keeps its typed name and a null id.
  customerId: { col: 'customer_id', type: 'id', label: 'Customer' },
  customerName: { col: 'customer_name', type: 'text', max: 100, label: 'Customer name' },
  referenceNo: { col: 'reference_no', type: 'text', max: 40, label: 'Reference #' },
  shipperName: { col: 'shipper_name', type: 'text', max: 100, label: 'Shipper' },
  shipperAddress: { col: 'shipper_address', type: 'text', max: 200, label: 'Shipper address' },
  shipperPhone: { col: 'shipper_phone', type: 'text', max: 30, label: 'Shipper phone' },
  consigneeName: { col: 'consignee_name', type: 'text', max: 100, label: 'Consignee' },
  consigneeAddress: { col: 'consignee_address', type: 'text', max: 200, label: 'Consignee address' },
  consigneePhone: { col: 'consignee_phone', type: 'text', max: 30, label: 'Consignee phone' },

  commodity: { col: 'commodity', type: 'text', max: 100, label: 'Commodity' },
  weightLbs: { col: 'weight_lbs', type: 'int', min: 1, label: 'Weight' },
  pieces: { col: 'pieces', type: 'int', min: 1, label: 'Pieces' },
  hazmat: { col: 'hazmat', type: 'bool', label: 'Hazmat' },
  tempF: { col: 'temp_f', type: 'int', min: -100, max: 200, label: 'Temperature' },
  notes: { col: 'notes', type: 'text', max: 1000, label: 'Notes' },
}

// Fields an anonymous visitor may see. What a public load board shows is the
// freight: where, when, what, and what it pays. Who is hauling it, whose
// freight it is, and the phone number of the dock are the carrier's business.
const PUBLIC_FIELDS = new Set([
  'id', 'origin', 'destination', 'miles', 'rate', 'equipment', 'status',
  'pickupStart', 'pickupEnd', 'deliveryStart', 'deliveryEnd',
  'commodity', 'weightLbs', 'pieces', 'hazmat', 'tempF', 'stopCount',
])

// Statuses an anonymous visitor may see loads in. Delivered and Cancelled are
// history, and history names names.
const PUBLIC_STATUSES = new Set(['Available', 'Covered', 'In Transit'])

// 'YYYY-MM-DDTHH:mm' from a datetime-local input, or a bare date, which reads
// as midnight. Normalised to seconds so SQL's CAST gets an unambiguous ISO
// string and never guesses at a DATEFORMAT setting.
const DATETIME = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

function normaliseDatetime(value) {
  const m = DATETIME.exec(value)
  if (!m) return null
  const [, y, mo, d, h = '00', mi = '00', s = '00'] = m
  const check = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s))
  if (Number.isNaN(check.getTime())) return null
  // Reject 2026-02-31 and 25:00, which Date.UTC would silently roll over.
  if (check.getUTCMonth() !== +mo - 1 || check.getUTCDate() !== +d || check.getUTCHours() !== +h || check.getUTCMinutes() !== +mi) return null
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`
}

// One field, one answer: { value } if it is acceptable, { error } if not.
// null and '' both mean "clear it", which is only an error for a required
// field. Numbers arrive as strings from HTML forms and as numbers from
// anything else, so both are accepted.
function checkField(name, raw) {
  const spec = FIELDS[name]
  const empty = raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')

  if (empty) {
    if (spec.required) return { error: `${spec.label} is required.` }
    return { value: spec.type === 'bool' ? false : null }
  }

  switch (spec.type) {
    case 'text': {
      if (typeof raw !== 'string') return { error: `${spec.label} must be text.` }
      const value = raw.trim()
      if (value.length > spec.max) return { error: `${spec.label} cannot be longer than ${spec.max} characters.` }
      return { value }
    }
    case 'int': {
      const n = Number(raw)
      if (!Number.isInteger(n)) return { error: `${spec.label} must be a whole number.` }
      if (spec.min !== undefined && n < spec.min) {
        return { error: spec.min === 1 ? `${spec.label} must be above zero.` : `${spec.label} must be at least ${spec.min}.` }
      }
      if (spec.max !== undefined && n > spec.max) return { error: `${spec.label} must be at most ${spec.max}.` }
      return { value: n }
    }
    case 'money': {
      const n = Number(raw)
      if (!Number.isFinite(n) || n < spec.min) return { error: `${spec.label} must be zero or more.` }
      return { value: Math.round(n * 100) / 100 }
    }
    case 'enum': {
      if (!spec.values.includes(raw)) return { error: `${spec.label} must be one of: ${spec.values.join(', ')}.` }
      return { value: raw }
    }
    case 'id': {
      const n = Number(raw)
      if (!Number.isInteger(n) || n <= 0) return { error: `${spec.label} is not valid.` }
      return { value: n }
    }
    case 'bool': {
      if (raw === true || raw === 'true' || raw === 1 || raw === '1' || raw === 'on') return { value: true }
      if (raw === false || raw === 'false' || raw === 0 || raw === '0' || raw === 'off') return { value: false }
      return { error: `${spec.label} must be yes or no.` }
    }
    case 'datetime': {
      if (typeof raw !== 'string') return { error: `${spec.label} must be a date.` }
      const value = normaliseDatetime(raw.trim())
      if (!value) return { error: `${spec.label} is not a valid date and time.` }
      return { value }
    }
    default:
      return { error: `${spec.label} cannot be validated.` }
  }
}

// Validate a body against FIELDS.
//
//   partial: false   a CREATE. Every required field must be present; absent
//                    optional fields are set to their empty value so the
//                    INSERT can name every column.
//   partial: true    a PATCH. Only the keys present are checked and returned;
//                    everything else is untouched.
//
// Returns { errors, fields } where fields is camelCase name -> clean value.
function validateFields(body, { partial = false } = {}) {
  const errors = []
  const fields = {}

  for (const name of Object.keys(FIELDS)) {
    const present = Object.prototype.hasOwnProperty.call(body, name)
    if (partial && !present) continue

    const { value, error } = checkField(name, present ? body[name] : undefined)
    if (error) errors.push(error)
    else fields[name] = value
  }

  // A window that ends before it starts. Checked across fields, so it lives
  // here rather than in checkField. Only checkable when both ends are in
  // hand, which on a PATCH they may not be; the CHECK constraint is the
  // backstop for the half-supplied case.
  for (const [start, end, label] of [
    ['pickupStart', 'pickupEnd', 'Pickup window'],
    ['deliveryStart', 'deliveryEnd', 'Delivery window'],
  ]) {
    if (fields[start] && fields[end] && fields[end] < fields[start]) {
      errors.push(`${label} ends before it starts.`)
    }
  }

  return { errors, fields }
}

// Which moves this user may make from this load's current state.
//
// Staff get the full table. The driver on the load gets forward only. Anybody
// else gets nothing -- including a driver looking at somebody else's load,
// and a staff account looking at a load in a state with no exits.
function allowedTransitions(user, load) {
  if (!user) return []
  if (user.role === 'dispatcher' || user.role === 'admin') {
    return TRANSITIONS[load.status] || []
  }
  if (user.role === 'driver' && user.driverCode && load.driverCode
      && user.driverCode.toUpperCase() === load.driverCode.toUpperCase()) {
    return DRIVER_TRANSITIONS[load.status] || []
  }
  return []
}

// The actions block the detail page renders from. Computed on the server so
// the browser does not carry a second copy of who-may-do-what that can drift
// from this one.
function actionsFor(user, load) {
  const staff = Boolean(user) && (user.role === 'dispatcher' || user.role === 'admin')
  return {
    canEdit: staff,
    canAssign: staff && load.status !== 'Delivered' && load.status !== 'Cancelled',
    transitions: allowedTransitions(user, load),
  }
}

// ---------------------------------------------------------------------------
// Plan a change.
//
// Takes the load as it is, the body as it arrived, and who is asking. Returns
// either { errors } or { next, events } -- the complete state the row should
// end up in and the LoadEvents rows that describe how it got there. The
// caller writes both in one transaction and nothing else.
//
// `today` is injected so a delivery marked at 23:30 Central does not land on
// tomorrow's date because the server's clock is in UTC. The client sends its
// own date; the server only supplies one if it did not.
// ---------------------------------------------------------------------------
function planChange(load, body, user, { today } = {}) {
  const errors = []
  const events = []
  const staff = Boolean(user) && (user.role === 'dispatcher' || user.role === 'admin')

  const wantsFields = Object.keys(FIELDS).some((k) => Object.prototype.hasOwnProperty.call(body, k))
  const wantsDriver = Object.prototype.hasOwnProperty.call(body, 'driverCode')
  const wantsUnit = Object.prototype.hasOwnProperty.call(body, 'unitNo')
  const wantsTrailer = Object.prototype.hasOwnProperty.call(body, 'trailerNo')
  const wantsStatus = Object.prototype.hasOwnProperty.call(body, 'status')

  if (!wantsFields && !wantsDriver && !wantsUnit && !wantsTrailer && !wantsStatus) {
    return { errors: ['Nothing to change.'] }
  }

  // Who may do what. Details and assignment are dispatch work. A status change
  // is either dispatch work or the driver reporting their own progress, and
  // allowedTransitions already knows which.
  if ((wantsFields || wantsDriver || wantsUnit || wantsTrailer) && !staff) {
    return { errors: ['Only a dispatcher can change a load\'s details or assignment.'], forbidden: true }
  }

  const next = { ...load }

  // 1. Details.
  if (wantsFields) {
    const { errors: fieldErrors, fields } = validateFields(body, { partial: true })
    errors.push(...fieldErrors)
    const changed = Object.keys(fields).filter((k) => fields[k] !== load[k])
    Object.assign(next, fields)
    if (changed.length) {
      events.push({
        type: 'Edited',
        detail: `Changed ${changed.map((k) => FIELDS[k].label.toLowerCase()).join(', ')}`,
      })
    }
  }

  // 2. Assignment: the driver, the truck, the trailer.
  if (wantsDriver || wantsUnit || wantsTrailer) {
    if (load.status === 'Delivered' || load.status === 'Cancelled') {
      errors.push(`A ${load.status.toLowerCase()} load cannot be reassigned. Move it back first.`)
    } else {
      if (wantsDriver) {
        const code = typeof body.driverCode === 'string' ? body.driverCode.trim().toUpperCase() : null
        if (code && !/^[A-Z0-9_-]{1,20}$/.test(code)) errors.push('That driver code is not valid.')
        next.driverCode = code || null
      }
      if (wantsUnit) {
        const unit = typeof body.unitNo === 'string' ? body.unitNo.trim() : null
        if (unit && unit.length > 20) errors.push('Unit cannot be longer than 20 characters.')
        next.unitNo = unit || null
      }
      if (wantsTrailer) {
        const trailer = typeof body.trailerNo === 'string' ? body.trailerNo.trim() : null
        if (trailer && trailer.length > 20) errors.push('Trailer cannot be longer than 20 characters.')
        next.trailerNo = trailer || null
      }
      // Assigning IS covering. A dispatcher who picks a driver has covered the
      // load and should not have to say so twice; clearing the driver uncovers
      // it. Only when the body does not also name a status -- if it does, the
      // explicit word wins and is checked below like any other move.
      if (wantsDriver && !wantsStatus) {
        if (next.driverCode && load.status === 'Available') next.status = 'Covered'
        if (!next.driverCode && (load.status === 'Covered' || load.status === 'In Transit')) next.status = 'Available'
      }
      if (next.driverCode !== load.driverCode) {
        events.push(next.driverCode
          ? { type: 'Assigned', driverCode: next.driverCode, detail: `Assigned to ${next.driverCode}${next.unitNo ? ` in ${next.unitNo}` : ''}` }
          : { type: 'Unassigned', driverCode: load.driverCode, detail: `Removed ${load.driverCode}` })
      } else {
        const changed = []
        if (wantsUnit && next.unitNo !== load.unitNo) changed.push(`unit to ${next.unitNo || 'none'}`)
        if (wantsTrailer && next.trailerNo !== load.trailerNo) changed.push(`trailer to ${next.trailerNo || 'none'}`)
        if (changed.length) events.push({ type: 'Edited', detail: `Changed ${changed.join(', ')}` })
      }
    }
  }

  // 3. Status.
  if (wantsStatus) {
    const to = body.status
    if (!STATUSES.includes(to)) {
      errors.push(`Status must be one of: ${STATUSES.join(', ')}.`)
    } else if (to !== load.status) {
      const allowed = allowedTransitions(user, load)
      if (!allowed.includes(to)) {
        // The same 403 shape whether the move is illegal for everyone or just
        // for this person -- "you may not" is true either way, and the
        // message says which so the driver knows to call dispatch.
        const legalForSomeone = (TRANSITIONS[load.status] || []).includes(to)
        return {
          errors: [legalForSomeone
            ? `Only a dispatcher can move a load from ${load.status} to ${to}.`
            : `A load cannot go from ${load.status} to ${to}.`],
          forbidden: legalForSomeone,
        }
      }
      next.status = to
    }
  }

  // 4. The invariants CK_Loads_lifecycle will enforce, checked here so they
  // come back as a sentence rather than a constraint name.
  if (next.status === 'Available') {
    next.driverCode = null
    next.unitNo = null
    next.trailerNo = null
    next.deliveredDate = null
  }
  if ((next.status === 'Covered' || next.status === 'In Transit') && !next.driverCode) {
    errors.push(`Assign a driver before marking the load ${next.status.toLowerCase()}.`)
  }
  if (next.status === 'Delivered') {
    if (!next.driverCode) errors.push('Assign a driver before marking the load delivered.')
    if (load.status !== 'Delivered') {
      const raw = typeof body.deliveredDate === 'string' ? body.deliveredDate.trim() : ''
      if (raw && !DATE.test(raw)) errors.push('Delivered date must be YYYY-MM-DD.')
      next.deliveredDate = raw || today || new Date().toISOString().slice(0, 10)
    }
  } else {
    next.deliveredDate = null
  }

  // A customer on hold owes money, and the answer to "can we cover their
  // load" is no until somebody lifts it. Checked on the way INTO a covered
  // state only: a load already moving is not abandoned at a truck stop
  // because AP flagged the broker this morning, and delivering it is how the
  // carrier gets paid at all.
  const entering = (next.status === 'Covered' || next.status === 'In Transit')
    && load.status !== 'Covered' && load.status !== 'In Transit'
  if (entering && next.status !== load.status && !coverable(load.customerStatus)) {
    errors.push(`${load.customerName || 'This customer'} is on ${load.customerStatus.toLowerCase()}. The load cannot be covered until dispatch clears it.`)
  }

  if (next.status !== load.status) {
    events.push({ type: 'Status', fromStatus: load.status, toStatus: next.status,
      detail: next.status === 'Delivered' ? `Delivered ${next.deliveredDate}` : null })
  }

  if (errors.length) return { errors }
  return { next, events }
}

module.exports = {
  STATUSES,
  EQUIPMENT,
  FIELDS,
  PUBLIC_FIELDS,
  PUBLIC_STATUSES,
  TRANSITIONS,
  DRIVER_TRANSITIONS,
  validateFields,
  allowedTransitions,
  actionsFor,
  planChange,
  normaliseDatetime,
}
