// ---------------------------------------------------------------------------
// What an invoice run would bill, and what an invoice is worth today.
//
// Pure functions, like payrunRules: rows in, a plan out, nothing fetched and
// nothing written, so every rule here is tested against literal data in
// invoiceRules.test.js and the route in functions/invoices.js is left with
// the SQL and the transaction.
//
// The plan mirrors the pay run's, on purpose: one invoice per CUSTOMER the
// way there is one settlement per DRIVER; the line haul of every unbilled
// delivered load, the way route pay is; and every unbilled charge marked
// bill_customer as an extra line, stragglers included -- a charge turned in
// after its load was invoiced goes on the next invoice by itself, the same
// way it goes on the next statement.
// ---------------------------------------------------------------------------

const round2 = (n) => Math.round(n * 100) / 100

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function validateRun({ invoiceDate, through }) {
  const errors = []
  if (!ISO_DATE.test(invoiceDate || '')) errors.push('Invoice date must be a date.')
  if (!ISO_DATE.test(through || '')) errors.push('The "delivered through" date must be a date.')
  if (errors.length) return errors
  if (through > invoiceDate) errors.push('Cannot invoice loads delivered after the invoice date.')
  return errors
}

// Today, and the last day of the previous month -- the run most carriers do,
// billing everything delivered by month end. If the month is young enough
// that yesterday is still last month, bill through yesterday instead so the
// default is never "nothing".
function defaultRun(today) {
  const t = new Date(`${today}T00:00:00Z`)
  const yesterday = new Date(t.getTime() - 86400000).toISOString().slice(0, 10)
  return { invoiceDate: today, through: yesterday }
}

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function dueDate(invoiceDate, termsDays) {
  return addDays(invoiceDate, Number(termsDays) || 0)
}

// INV-yyMMdd-NNNN, the same shape as a settlement's CK-yyMMdd-NNNN so the
// two number series read alike on a load's history.
function invoiceNo(invoiceDate, seq) {
  return `INV-${invoiceDate.slice(2, 4)}${invoiceDate.slice(5, 7)}${invoiceDate.slice(8, 10)}-${String(seq).padStart(4, '0')}`
}

function laneOf(load) {
  return `${load.origin} - ${load.destination}`.toUpperCase()
}

// The plan.
//
//   loads      unbilled Delivered loads with a customer_id, through the date
//   charges    unbilled bill_customer charges on Delivered loads with a
//              customer_id (any load, billed already or not)
//   customers  { [customerId]: { name, status, termsDays, creditLimit,
//                billTo..., openBalance } }
//
// A customer on Hold is still invoiced -- the hold stops dispatch from
// covering NEW freight, and freight already delivered is owed regardless.
// It is flagged so billing sees it, and so is a customer whose open balance
// plus this invoice would pass their credit limit.
function plan(loads, charges, customers, { invoiceDate, through }) {
  const byCustomer = new Map()
  const ensure = (id) => {
    if (!byCustomer.has(id)) {
      const c = customers[id] || { name: `Customer ${id}`, status: null, termsDays: 30, creditLimit: null, openBalance: 0 }
      byCustomer.set(id, {
        customerId: Number(id),
        name: c.name,
        status: c.status,
        termsDays: Number(c.termsDays),
        dueDate: dueDate(invoiceDate, c.termsDays),
        billToName: c.name,
        billToAddress: c.billToAddress || null,
        openBalance: round2(Number(c.openBalance || 0)),
        creditLimit: c.creditLimit === null || c.creditLimit === undefined ? null : Number(c.creditLimit),
        loads: [],
        charges: [],
        linehaul: 0,
        extras: 0,
        total: 0,
        stragglers: 0,
        onHold: c.status === 'Hold',
        overCredit: false,
      })
    }
    return byCustomer.get(id)
  }

  const billedHere = new Set()
  for (const l of loads) {
    if (!l.customerId || l.status !== 'Delivered' || l.invoiceId) continue
    if (l.deliveredDate > through) continue
    const inv = ensure(l.customerId)
    inv.loads.push({
      id: l.id, lane: laneOf(l), deliveredDate: l.deliveredDate, referenceNo: l.referenceNo || null,
      miles: Number(l.miles || 0), amount: round2(Number(l.rate)),
    })
    inv.linehaul = round2(inv.linehaul + Number(l.rate))
    billedHere.add(l.id)
  }

  for (const c of charges) {
    if (!c.customerId || !c.billCustomer || c.invoiceLineId) continue
    if (c.deliveredDate > through) continue
    const amount = round2(Number(c.billAmount === null || c.billAmount === undefined ? c.amount : c.billAmount))
    if (amount <= 0) continue
    const inv = ensure(c.customerId)
    const straggler = !billedHere.has(c.loadId)
    inv.charges.push({ chargeId: c.chargeId, loadId: c.loadId, code: c.code, description: c.description, amount, straggler })
    inv.extras = round2(inv.extras + amount)
    if (straggler) inv.stragglers += 1
  }

  const invoices = [...byCustomer.values()]
    .map((inv) => {
      inv.total = round2(inv.linehaul + inv.extras)
      inv.overCredit = inv.creditLimit !== null && round2(inv.openBalance + inv.total) > inv.creditLimit
      inv.loads.sort((a, b) => a.deliveredDate.localeCompare(b.deliveredDate) || a.id.localeCompare(b.id))
      inv.charges.sort((a, b) => a.loadId.localeCompare(b.loadId) || a.chargeId - b.chargeId)
      return inv
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const totals = invoices.reduce((t, i) => ({
    customers: t.customers + 1,
    loads: t.loads + i.loads.length,
    charges: t.charges + i.charges.length,
    linehaul: round2(t.linehaul + i.linehaul),
    extras: round2(t.extras + i.extras),
    total: round2(t.total + i.total),
    flagged: t.flagged + (i.onHold || i.overCredit ? 1 : 0),
  }), { customers: 0, loads: 0, charges: 0, linehaul: 0, extras: 0, total: 0, flagged: 0 })

  return { invoiceDate, through, invoices, totals }
}

// ---------------------------------------------------------------------------
// An invoice today: what is still owed, how late it is, and which aging
// bucket it sits in. The buckets are the ones every AR report uses; the
// numbers are days past DUE, not past invoice date, because a 45-day
// customer is not late on day 31.
// ---------------------------------------------------------------------------
const BUCKETS = ['current', '1-30', '31-60', '61-90', '90+']

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000)
}

function aging(invoice, today) {
  const balance = round2(Number(invoice.total) - Number(invoice.paidAmount || 0))
  if (invoice.status !== 'Open' || balance <= 0) {
    return { balance: invoice.status === 'Open' ? balance : 0, daysPastDue: 0, bucket: null, overdue: false }
  }
  const daysPastDue = Math.max(0, daysBetween(invoice.dueDate, today))
  const bucket = daysPastDue <= 0 ? 'current'
    : daysPastDue <= 30 ? '1-30'
    : daysPastDue <= 60 ? '31-60'
    : daysPastDue <= 90 ? '61-90'
    : '90+'
  return { balance, daysPastDue, bucket, overdue: daysPastDue > 0 }
}

// Sum a list of open invoices into the buckets.
function agingSummary(invoices, today) {
  const out = { total: 0, overdue: 0, count: 0, buckets: Object.fromEntries(BUCKETS.map((b) => [b, 0])) }
  for (const inv of invoices) {
    const a = aging(inv, today)
    if (!a.bucket) continue
    out.count += 1
    out.total = round2(out.total + a.balance)
    if (a.overdue) out.overdue = round2(out.overdue + a.balance)
    out.buckets[a.bucket] = round2(out.buckets[a.bucket] + a.balance)
  }
  return out
}

// ---------------------------------------------------------------------------
// Recording a payment. Returns the fields to write, or an error. Paying more
// than is owed is refused rather than stored as a credit: a credit balance
// is a real thing in AR and this app does not have it, so the honest answer
// is "that is more than the invoice".
// ---------------------------------------------------------------------------
function applyPayment(invoice, { amount, paidDate }) {
  const errors = []
  const n = Number(amount)
  if (!Number.isFinite(n) || n <= 0) errors.push('Payment must be a positive amount.')
  if (!ISO_DATE.test(paidDate || '')) errors.push('Payment date must be a date.')
  if (invoice.status === 'Void') errors.push('A voided invoice cannot be paid.')
  if (invoice.status === 'Paid') errors.push('That invoice is already paid.')
  if (errors.length) return { errors }
  const balance = round2(Number(invoice.total) - Number(invoice.paidAmount || 0))
  if (round2(n) > balance) errors.push(`That is more than the ${balance.toFixed(2)} still owed.`)
  if (errors.length) return { errors }
  const paidAmount = round2(Number(invoice.paidAmount || 0) + n)
  return {
    errors: [],
    fields: { paidAmount, paidDate, status: paidAmount >= Number(invoice.total) ? 'Paid' : 'Open' },
  }
}

module.exports = {
  validateRun, defaultRun, dueDate, invoiceNo, laneOf, plan,
  BUCKETS, aging, agingSummary, applyPayment, addDays,
}
