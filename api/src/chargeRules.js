// ---------------------------------------------------------------------------
// Accessorial charges on a load: what they look like, who may add which, and
// how they become settlement lines. No database, no HTTP.
// ---------------------------------------------------------------------------

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

// The codes the form offers, each with the kind it is and the words the
// statement prints by default. OTHER exists so nothing is forced into the
// wrong box; it needs a description typed.
const CODES = {
  DETENTION: { lineType: 'REVENUE', description: 'DETENTION' },
  LAYOVER: { lineType: 'REVENUE', description: 'LAYOVER' },
  STOPOFF: { lineType: 'REVENUE', description: 'STOP OFF PAY' },
  FSC: { lineType: 'REVENUE', description: 'FUEL SURCHARGE' },
  TOLLS: { lineType: 'REIMBURSEMENT', description: 'TOLLS' },
  LUMPER: { lineType: 'REIMBURSEMENT', description: 'LUMPER' },
  SCALE: { lineType: 'REIMBURSEMENT', description: 'SCALE' },
  WASHOUT: { lineType: 'REIMBURSEMENT', description: 'WASH OUT' },
  OTHER: { lineType: null, description: null },
}

const LINE_TYPES = ['REVENUE', 'REIMBURSEMENT']

// { errors, charge } for a body. The code decides the type and default
// description; OTHER must say both. Amounts are to the driver and positive.
function validateCharge(body) {
  const errors = []
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : ''
  const spec = CODES[code]
  if (!spec) errors.push(`Code must be one of: ${Object.keys(CODES).join(', ')}.`)

  let lineType = spec?.lineType || null
  if (typeof body.lineType === 'string' && body.lineType.trim()) {
    const t = body.lineType.trim().toUpperCase()
    if (!LINE_TYPES.includes(t)) errors.push('Type must be REVENUE or REIMBURSEMENT.')
    else lineType = t
  }
  if (spec && !lineType) errors.push('Say whether this is extra pay (REVENUE) or money back (REIMBURSEMENT).')

  let description = typeof body.description === 'string' ? body.description.trim() : ''
  if (!description) description = spec?.description || ''
  if (!description) errors.push('Description is required.')
  else if (description.length > 120) errors.push('Description cannot be longer than 120 characters.')

  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) errors.push('Amount must be above zero.')

  const billCustomer = body.billCustomer === true || body.billCustomer === 'true' || body.billCustomer === 1
  let billAmount = null
  if (body.billAmount !== undefined && body.billAmount !== null && body.billAmount !== '') {
    const b = Number(body.billAmount)
    if (!Number.isFinite(b) || b < 0) errors.push('Billed amount must be zero or more.')
    else billAmount = round2(b)
  }

  const receiptNote = typeof body.receiptNote === 'string' ? body.receiptNote.trim() : ''
  if (receiptNote.length > 200) errors.push('Receipt note cannot be longer than 200 characters.')

  if (errors.length) return { errors }
  return {
    errors: [],
    charge: {
      code, lineType, description: description.toUpperCase(), amount: round2(amount),
      billCustomer, billAmount, receiptNote: receiptNote || null,
    },
  }
}

// Who may add what. Dispatch adds anything. The driver on the load may add a
// REIMBURSEMENT -- they are the one holding the receipt -- and nothing that
// pays them more. Nobody else adds anything.
function canAdd(user, load, charge) {
  if (!user) return false
  if (user.role === 'dispatcher' || user.role === 'admin') return true
  if (user.role === 'driver' && user.driverCode && load.driverCode
      && user.driverCode.toUpperCase() === load.driverCode.toUpperCase()) {
    return charge.lineType === 'REIMBURSEMENT'
  }
  return false
}

// Settlement lines from a driver's unpaid charges. Positive, the way both
// kinds are added to the total; order_no is the load so the statement's
// "by load" sections can place them.
function linesFrom(charges) {
  return charges.map((c) => ({
    type: c.lineType,
    orderNo: c.loadId,
    code: c.code,
    description: c.description,
    amount: round2(Number(c.amount)),
    chargeId: c.chargeId ?? null,
  }))
}

module.exports = { CODES, LINE_TYPES, validateCharge, canAdd, linesFrom, round2 }
