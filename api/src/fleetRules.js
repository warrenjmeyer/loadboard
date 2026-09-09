// ---------------------------------------------------------------------------
// The rules of a truck and a trailer, with no database and no HTTP in them.
// Same division as loadRules.js: fleet.js asks, this answers, fleetRules
// .test.js checks every branch without a connection string.
// ---------------------------------------------------------------------------

const STATUSES = ['Active', 'Shop', 'Retired']
const TRAILER_TYPES = ['Dry Van', 'Reefer', 'Flatbed']
const OWNER_TYPES = ['COMPANY', 'OWNER']

// Unit and trailer numbers: what MyGeotab and the settlements already use.
// Letters, digits, spaces, dots and dashes -- "Demo - 01", "T-101", "1542".
const UNIT_NO = /^[A-Za-z0-9][A-Za-z0-9 .\-]{0,19}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const PLATE = /^[A-Za-z0-9 \-]{1,12}$/
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/i   // no I, O or Q, by the standard

const TRUCK_FIELDS = {
  description: { col: 'description', type: 'text', max: 80, required: true, label: 'Description' },
  modelYear: { col: 'model_year', type: 'int', min: 1980, max: 2100, label: 'Year' },
  make: { col: 'make', type: 'text', max: 40, label: 'Make' },
  model: { col: 'model', type: 'text', max: 40, label: 'Model' },
  vin: { col: 'vin', type: 'vin', label: 'VIN' },
  plate: { col: 'plate', type: 'plate', label: 'Plate' },
  plateState: { col: 'plate_state', type: 'state', label: 'Plate state' },
  status: { col: 'status', type: 'enum', values: STATUSES, label: 'Status' },
  ownerType: { col: 'owner_type', type: 'enum', values: OWNER_TYPES, label: 'Owner' },
  ownerDriverCode: { col: 'owner_driver_code', type: 'code', label: 'Owner driver' },
  registrationExpires: { col: 'registration_expires', type: 'date', label: 'Registration expires' },
  inspectionDue: { col: 'inspection_due', type: 'date', label: 'Inspection due' },
  notes: { col: 'notes', type: 'text', max: 400, label: 'Notes' },
}

const TRAILER_FIELDS = {
  trailerType: { col: 'trailer_type', type: 'enum', values: TRAILER_TYPES, required: true, label: 'Type' },
  description: { col: 'description', type: 'text', max: 80, label: 'Description' },
  plate: { col: 'plate', type: 'plate', label: 'Plate' },
  plateState: { col: 'plate_state', type: 'state', label: 'Plate state' },
  status: { col: 'status', type: 'enum', values: STATUSES, label: 'Status' },
  registrationExpires: { col: 'registration_expires', type: 'date', label: 'Registration expires' },
  inspectionDue: { col: 'inspection_due', type: 'date', label: 'Inspection due' },
  notes: { col: 'notes', type: 'text', max: 400, label: 'Notes' },
}

function checkField(spec, raw) {
  const empty = raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')
  if (empty) {
    if (spec.required) return { error: `${spec.label} is required.` }
    return { value: null }
  }
  const s = typeof raw === 'string' ? raw.trim() : raw

  switch (spec.type) {
    case 'text':
      if (typeof s !== 'string') return { error: `${spec.label} must be text.` }
      if (s.length > spec.max) return { error: `${spec.label} cannot be longer than ${spec.max} characters.` }
      return { value: s }
    case 'int': {
      const n = Number(s)
      if (!Number.isInteger(n)) return { error: `${spec.label} must be a whole number.` }
      if (n < spec.min || n > spec.max) return { error: `${spec.label} must be between ${spec.min} and ${spec.max}.` }
      return { value: n }
    }
    case 'enum':
      if (!spec.values.includes(s)) return { error: `${spec.label} must be one of: ${spec.values.join(', ')}.` }
      return { value: s }
    case 'date':
      if (typeof s !== 'string' || !DATE.test(s) || Number.isNaN(Date.parse(s))) return { error: `${spec.label} must be YYYY-MM-DD.` }
      return { value: s }
    case 'plate':
      if (typeof s !== 'string' || !PLATE.test(s)) return { error: `${spec.label} may only contain letters, digits, spaces and dashes.` }
      return { value: s.toUpperCase() }
    case 'state':
      if (typeof s !== 'string' || !/^[A-Za-z]{2}$/.test(s)) return { error: `${spec.label} must be two letters.` }
      return { value: s.toUpperCase() }
    case 'vin':
      if (typeof s !== 'string' || !VIN.test(s)) return { error: `${spec.label} must be 17 characters with no I, O or Q.` }
      return { value: s.toUpperCase() }
    case 'code':
      if (typeof s !== 'string' || !/^[A-Za-z0-9_-]{1,20}$/.test(s)) return { error: `${spec.label} is not a valid driver code.` }
      return { value: s.toUpperCase() }
    default:
      return { error: `${spec.label} cannot be validated.` }
  }
}

// { errors, fields }. partial: true checks only what was sent (a PATCH);
// otherwise every required field must be present and the rest are nulled so
// an INSERT can name every column. Defaults for status and owner type are
// applied on a create, because a truck added with neither is Active and the
// company's -- which is what the table's defaults say too.
function validateFields(FIELDS, body, { partial = false } = {}) {
  const errors = []
  const fields = {}
  for (const [name, spec] of Object.entries(FIELDS)) {
    const present = Object.prototype.hasOwnProperty.call(body, name)
    if (partial && !present) continue
    const { value, error } = checkField(spec, present ? body[name] : undefined)
    if (error) errors.push(error)
    else fields[name] = value
  }
  if (!partial) {
    if (fields.status === null) fields.status = 'Active'
    if ('ownerType' in fields && fields.ownerType === null) fields.ownerType = 'COMPANY'
  }
  return { errors, fields }
}

function validateTruck(body, opts) {
  const out = validateFields(TRUCK_FIELDS, body, opts)
  // CK_Trucks_owner, in words. Only checkable when both halves are in hand.
  const { ownerType, ownerDriverCode } = out.fields
  if (ownerType !== undefined && ownerDriverCode !== undefined) {
    if (ownerType === 'OWNER' && !ownerDriverCode) out.errors.push('An owner/operator truck must name its owner.')
    if (ownerType === 'COMPANY' && ownerDriverCode) out.errors.push('A company truck has no owner driver.')
  }
  return out
}

function validateTrailer(body, opts) {
  return validateFields(TRAILER_FIELDS, body, opts)
}

function validateUnitNo(raw, label = 'Unit #') {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return { error: `${label} is required.` }
  if (!UNIT_NO.test(s)) return { error: `${label} may only contain letters, digits, spaces, dots and dashes, up to 20 characters.` }
  return { value: s }
}

// How many days until a date, from `today`. Negative means it has passed.
// Used to decide what the fleet page warns about; computed on the server so
// the browser's clock does not decide whether a plate is expired.
function daysUntil(iso, today) {
  if (!iso) return null
  const a = Date.parse(`${today}T00:00:00Z`)
  const b = Date.parse(`${iso}T00:00:00Z`)
  return Math.round((b - a) / 86400000)
}

module.exports = {
  STATUSES,
  TRAILER_TYPES,
  OWNER_TYPES,
  TRUCK_FIELDS,
  TRAILER_FIELDS,
  validateTruck,
  validateTrailer,
  validateUnitNo,
  daysUntil,
}
