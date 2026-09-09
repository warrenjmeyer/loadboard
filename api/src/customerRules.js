// ---------------------------------------------------------------------------
// The rules of a customer, with no database and no HTTP in them.
// ---------------------------------------------------------------------------

const TYPES = ['Shipper', 'Broker']
const STATUSES = ['Active', 'Hold', 'Inactive']

// "MC-123456" or "123456"; stored as typed with the prefix upper-cased. The
// FMCSA number is 4 to 8 digits in practice.
const MC = /^(MC-?)?\d{4,8}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const FIELDS = {
  name: { col: 'name', type: 'text', max: 100, required: true, label: 'Name' },
  customerType: { col: 'customer_type', type: 'enum', values: TYPES, label: 'Type' },
  mcNumber: { col: 'mc_number', type: 'mc', label: 'MC number' },
  address1: { col: 'address1', type: 'text', max: 100, label: 'Address' },
  city: { col: 'city', type: 'text', max: 60, label: 'City' },
  state: { col: 'state', type: 'state', label: 'State' },
  postalCode: { col: 'postal_code', type: 'text', max: 10, label: 'ZIP' },
  phone: { col: 'phone', type: 'text', max: 30, label: 'Phone' },
  email: { col: 'email', type: 'email', label: 'Email' },
  contactName: { col: 'contact_name', type: 'text', max: 80, label: 'Contact' },
  paymentTermsDays: { col: 'payment_terms_days', type: 'int', min: 0, max: 180, label: 'Payment terms' },
  creditLimit: { col: 'credit_limit', type: 'money', label: 'Credit limit' },
  status: { col: 'status', type: 'enum', values: STATUSES, label: 'Status' },
  notes: { col: 'notes', type: 'text', max: 1000, label: 'Notes' },
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
    case 'enum':
      if (!spec.values.includes(s)) return { error: `${spec.label} must be one of: ${spec.values.join(', ')}.` }
      return { value: s }
    case 'int': {
      const n = Number(s)
      if (!Number.isInteger(n)) return { error: `${spec.label} must be a whole number.` }
      if (n < spec.min || n > spec.max) return { error: `${spec.label} must be between ${spec.min} and ${spec.max}.` }
      return { value: n }
    }
    case 'money': {
      const n = Number(s)
      if (!Number.isFinite(n) || n < 0) return { error: `${spec.label} must be zero or more.` }
      return { value: Math.round(n * 100) / 100 }
    }
    case 'state':
      if (typeof s !== 'string' || !/^[A-Za-z]{2}$/.test(s)) return { error: `${spec.label} must be two letters.` }
      return { value: s.toUpperCase() }
    case 'mc':
      if (typeof s !== 'string' || !MC.test(s)) return { error: `${spec.label} must be MC- followed by 4 to 8 digits.` }
      return { value: `MC-${s.replace(/^MC-?/i, '')}` }
    case 'email':
      if (typeof s !== 'string' || s.length > 254 || !EMAIL.test(s)) return { error: `${spec.label} does not look like an address.` }
      return { value: s.toLowerCase() }
    default:
      return { error: `${spec.label} cannot be validated.` }
  }
}

// { errors, fields }. partial: true checks only what was sent.
function validateCustomer(body, { partial = false } = {}) {
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
    if (fields.customerType === null) fields.customerType = 'Broker'
    if (fields.status === null) fields.status = 'Active'
    if (fields.paymentTermsDays === null) fields.paymentTermsDays = 30
  }
  return { errors, fields }
}

// May a load for this customer be covered? A customer on hold owes money;
// the answer is no until somebody takes the hold off. Inactive is "we do not
// work with them any more", which is also no. Null means the load has no
// customer record, which is allowed -- not every load has been linked yet.
function coverable(customerStatus) {
  return customerStatus === null || customerStatus === undefined || customerStatus === 'Active'
}

module.exports = { TYPES, STATUSES, FIELDS, validateCustomer, coverable }
