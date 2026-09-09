// ---------------------------------------------------------------------------
// Standing deductions: what they look like, and what they take from one
// settlement. No database, no HTTP; deductionRules.test.js covers it.
// ---------------------------------------------------------------------------

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
const BASES = ['FLAT', 'PER_MILE']
const DATE = /^\d{4}-\d{2}-\d{2}$/
const CODE = /^[A-Z0-9_-]{1,20}$/i

const FIELDS = {
  code: { col: 'code', type: 'code', required: true, label: 'Code' },
  description: { col: 'description', type: 'text', max: 120, required: true, label: 'Description' },
  basis: { col: 'basis', type: 'enum', values: BASES, label: 'Basis' },
  amount: { col: 'amount', type: 'amount', required: true, label: 'Amount' },
  escrowCode: { col: 'escrow_code', type: 'code', label: 'Escrow account' },
  escrowOpening: { col: 'escrow_opening', type: 'money', label: 'Escrow opening balance' },
  balance: { col: 'balance', type: 'money', label: 'Balance owed' },
  startDate: { col: 'start_date', type: 'date', label: 'Start date' },
  endDate: { col: 'end_date', type: 'date', label: 'End date' },
  active: { col: 'active', type: 'bool', label: 'Active' },
  notes: { col: 'notes', type: 'text', max: 400, label: 'Notes' },
}

function checkField(spec, raw) {
  const empty = raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')
  if (empty) {
    if (spec.required) return { error: `${spec.label} is required.` }
    return { value: spec.type === 'bool' ? null : null }
  }
  const s = typeof raw === 'string' ? raw.trim() : raw
  switch (spec.type) {
    case 'text':
      if (typeof s !== 'string') return { error: `${spec.label} must be text.` }
      if (s.length > spec.max) return { error: `${spec.label} cannot be longer than ${spec.max} characters.` }
      return { value: s }
    case 'code':
      if (typeof s !== 'string' || !CODE.test(s)) return { error: `${spec.label} may only contain letters, digits, dashes and underscores, up to 20.` }
      return { value: s.toUpperCase() }
    case 'enum':
      if (!spec.values.includes(s)) return { error: `${spec.label} must be one of: ${spec.values.join(', ')}.` }
      return { value: s }
    case 'amount': {
      const n = Number(s)
      if (!Number.isFinite(n) || n <= 0) return { error: `${spec.label} must be above zero.` }
      return { value: Math.round(n * 10000) / 10000 }
    }
    case 'money': {
      const n = Number(s)
      if (!Number.isFinite(n) || n < 0) return { error: `${spec.label} must be zero or more.` }
      return { value: round2(n) }
    }
    case 'date':
      if (typeof s !== 'string' || !DATE.test(s)) return { error: `${spec.label} must be YYYY-MM-DD.` }
      return { value: s }
    case 'bool':
      if (s === true || s === 'true' || s === 1 || s === '1') return { value: true }
      if (s === false || s === 'false' || s === 0 || s === '0') return { value: false }
      return { error: `${spec.label} must be yes or no.` }
    default:
      return { error: `${spec.label} cannot be validated.` }
  }
}

function validateDeduction(body, { partial = false } = {}) {
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
    if (fields.basis === null) fields.basis = 'FLAT'
    if (fields.active === null) fields.active = true
  }
  if (fields.startDate && fields.endDate && fields.endDate < fields.startDate) {
    errors.push('End date is before start date.')
  }
  // A per-mile escrow contribution is a thing nobody has asked for, and an
  // escrow loan is a contradiction; refuse both rather than guess.
  if (fields.escrowCode && fields.basis === 'PER_MILE') errors.push('An escrow contribution must be a flat amount.')
  if (fields.escrowCode && fields.balance !== null && fields.balance !== undefined) errors.push('An escrow contribution cannot also be a loan.')
  return { errors, fields }
}

// Does this standing order apply to a settlement on this check date?
function isDue(d, checkDate) {
  if (!d.active) return false
  if (d.startDate && checkDate < d.startDate) return false
  if (d.endDate && checkDate > d.endDate) return false
  if (d.balance !== null && d.balance !== undefined && d.balance <= 0) return false
  return true
}

// What a driver's standing orders take from one settlement.
//
//   deductions      this driver's rows
//   totalMiles      the miles the settlement pays, for PER_MILE
//   escrowBalances  { code: current balance } from the driver's last statement
//   checkDate       for start/end
//
// Returns the SettlementLines rows, the SettlementEscrow rows, the balance
// updates for loans, and the total, all signed the way the tables want them.
function linesFor(deductions, { totalMiles, escrowBalances = {}, checkDate }) {
  const lines = []
  const escrow = []
  const balanceUpdates = []

  for (const d of deductions) {
    if (!isDue(d, checkDate)) continue

    let taken = d.basis === 'PER_MILE' ? round2(totalMiles * Number(d.amount)) : round2(Number(d.amount))
    const isLoan = d.balance !== null && d.balance !== undefined
    if (isLoan) taken = Math.min(taken, round2(Number(d.balance)))
    if (taken <= 0) continue

    lines.push({
      type: 'DEDUCTION',
      code: d.code,
      description: d.description,
      amount: -taken,
      deductionId: d.deductionId ?? null,
      escrowCode: d.escrowCode || null,
    })

    if (d.escrowCode) {
      const beginning = escrowBalances[d.escrowCode] !== undefined
        ? round2(Number(escrowBalances[d.escrowCode]))
        : round2(Number(d.escrowOpening || 0))
      escrow.push({
        code: d.escrowCode,
        description: d.description,
        beginning,
        transaction: taken,
        current: round2(beginning + taken),
      })
    }

    if (isLoan) {
      balanceUpdates.push({ deductionId: d.deductionId ?? null, balance: round2(Number(d.balance) - taken) })
    }
  }

  return {
    lines,
    escrow,
    balanceUpdates,
    deductionTotal: round2(lines.reduce((t, l) => t + l.amount, 0)),
  }
}

module.exports = { BASES, FIELDS, validateDeduction, isDue, linesFor, round2 }
