const test = require('node:test')
const assert = require('node:assert/strict')
const rules = require('./invoiceRules')

test('a run needs two dates, and cannot bill loads delivered after the invoice date', () => {
  assert.deepEqual(rules.validateRun({ invoiceDate: '2026-09-10', through: '2026-08-31' }), [])
  assert.deepEqual(rules.validateRun({ invoiceDate: '2026-09-10', through: '2026-09-10' }), [])
  assert.ok(rules.validateRun({ invoiceDate: '2026-09-10', through: '2026-09-11' })[0].startsWith('Cannot invoice'))
  assert.equal(rules.validateRun({ invoiceDate: 'tomorrow', through: '' }).length, 2)
})

test('the default run bills through yesterday, dated today', () => {
  assert.deepEqual(rules.defaultRun('2026-09-10'), { invoiceDate: '2026-09-10', through: '2026-09-09' })
  assert.deepEqual(rules.defaultRun('2026-03-01'), { invoiceDate: '2026-03-01', through: '2026-02-28' })
})

test('due date follows the terms, and the number follows the date', () => {
  assert.equal(rules.dueDate('2026-09-10', 30), '2026-10-10')
  assert.equal(rules.dueDate('2026-12-20', 15), '2027-01-04')
  assert.equal(rules.dueDate('2026-09-10', 0), '2026-09-10')
  assert.equal(rules.invoiceNo('2026-09-10', 3), 'INV-260910-0003')
})

const CUSTOMERS = {
  1: { name: 'Prairie Freight Partners', status: 'Active', termsDays: 15, creditLimit: 40000, openBalance: 0, billToAddress: '8100 W Dodge Rd, Omaha, NE 68114' },
  6: { name: 'Riverbend Logistics LLC', status: 'Hold', termsDays: 45, creditLimit: 10000, openBalance: 9500 },
  2: { name: 'Mississippi Valley Foods', status: 'Active', termsDays: 30, creditLimit: null, openBalance: 0 },
}
const LOADS = [
  { id: 'L-2', customerId: 1, status: 'Delivered', invoiceId: null, deliveredDate: '2026-09-03', origin: 'Dubuque, IA', destination: 'Chicago, IL', miles: 182, rate: 585, referenceNo: 'PO-77' },
  { id: 'L-1', customerId: 1, status: 'Delivered', invoiceId: null, deliveredDate: '2026-09-01', origin: 'Waterloo, IA', destination: 'Minneapolis, MN', miles: 246, rate: 700 },
  { id: 'L-3', customerId: 6, status: 'Delivered', invoiceId: null, deliveredDate: '2026-09-02', origin: 'Cedar Rapids, IA', destination: 'Chicago, IL', miles: 224, rate: 660.8 },
  // Already billed: not again.
  { id: 'L-4', customerId: 1, status: 'Delivered', invoiceId: 12, deliveredDate: '2026-09-02', origin: 'A', destination: 'B', miles: 1, rate: 100 },
  // Delivered after the through date: next time.
  { id: 'L-5', customerId: 1, status: 'Delivered', invoiceId: null, deliveredDate: '2026-09-09', origin: 'A', destination: 'B', miles: 1, rate: 100 },
  // Not delivered, and no customer record: never.
  { id: 'L-6', customerId: 1, status: 'In Transit', invoiceId: null, deliveredDate: null, origin: 'A', destination: 'B', miles: 1, rate: 100 },
  { id: 'L-7', customerId: null, status: 'Delivered', invoiceId: null, deliveredDate: '2026-09-01', origin: 'A', destination: 'B', miles: 1, rate: 100 },
]
const CHARGES = [
  // Billed at a different amount from what the driver gets.
  { chargeId: 1, loadId: 'L-2', customerId: 1, deliveredDate: '2026-09-03', billCustomer: true, invoiceLineId: null, code: 'DETENTION', description: 'DETENTION - 2 HRS', amount: 90, billAmount: 150 },
  // Billed at cost.
  { chargeId: 2, loadId: 'L-2', customerId: 1, deliveredDate: '2026-09-03', billCustomer: true, invoiceLineId: null, code: 'LUMPER', description: 'LUMPER', amount: 125, billAmount: null },
  // Not billable to the customer.
  { chargeId: 3, loadId: 'L-1', customerId: 1, deliveredDate: '2026-09-01', billCustomer: false, invoiceLineId: null, code: 'TOLLS', description: 'TOLLS', amount: 40, billAmount: null },
  // A straggler: its load (L-4) was invoiced already.
  { chargeId: 4, loadId: 'L-4', customerId: 1, deliveredDate: '2026-09-02', billCustomer: true, invoiceLineId: null, code: 'STOPOFF', description: 'STOP-OFF', amount: 50, billAmount: 75 },
  // Already on an invoice line.
  { chargeId: 5, loadId: 'L-4', customerId: 1, deliveredDate: '2026-09-02', billCustomer: true, invoiceLineId: 9, code: 'FSC', description: 'FUEL SURCHARGE', amount: 30, billAmount: 30 },
]

test('the plan: one invoice per customer, unbilled loads and billable charges, stragglers marked', () => {
  const p = rules.plan(LOADS, CHARGES, CUSTOMERS, { invoiceDate: '2026-09-08', through: '2026-09-07' })
  assert.deepEqual(p.invoices.map((i) => i.name), ['Prairie Freight Partners', 'Riverbend Logistics LLC'])

  const prairie = p.invoices[0]
  assert.deepEqual(prairie.loads.map((l) => l.id), ['L-1', 'L-2'])
  assert.equal(prairie.loads[1].lane, 'DUBUQUE, IA - CHICAGO, IL')
  assert.equal(prairie.loads[1].referenceNo, 'PO-77')
  assert.equal(prairie.linehaul, 1285)
  assert.deepEqual(prairie.charges.map((c) => [c.chargeId, c.amount, c.straggler]), [[1, 150, false], [2, 125, false], [4, 75, true]])
  assert.equal(prairie.extras, 350)
  assert.equal(prairie.total, 1635)
  assert.equal(prairie.stragglers, 1)
  assert.equal(prairie.dueDate, '2026-09-23')
  assert.equal(prairie.billToAddress, '8100 W Dodge Rd, Omaha, NE 68114')
  assert.equal(prairie.onHold, false)
  assert.equal(prairie.overCredit, false)

  const riverbend = p.invoices[1]
  assert.equal(riverbend.total, 660.8)
  assert.equal(riverbend.onHold, true)
  // 9,500 open + 660.80 passes a 10,000 limit.
  assert.equal(riverbend.overCredit, true)
  assert.equal(riverbend.dueDate, '2026-10-23')

  assert.deepEqual(p.totals, { customers: 2, loads: 3, charges: 3, linehaul: 1945.8, extras: 350, total: 2295.8, flagged: 1 })
})

test('a customer with only a straggling charge still gets an invoice', () => {
  const p = rules.plan([], [CHARGES[3]], CUSTOMERS, { invoiceDate: '2026-09-08', through: '2026-09-07' })
  assert.equal(p.invoices.length, 1)
  assert.equal(p.invoices[0].loads.length, 0)
  assert.equal(p.invoices[0].total, 75)
})

test('nothing to bill is an empty plan, not an error', () => {
  const p = rules.plan([], [], CUSTOMERS, { invoiceDate: '2026-09-08', through: '2026-09-07' })
  assert.deepEqual(p.invoices, [])
  assert.equal(p.totals.total, 0)
})

test('aging counts days past DUE, into the usual buckets', () => {
  const inv = { status: 'Open', total: 1000, paidAmount: 250, dueDate: '2026-08-01' }
  assert.deepEqual(rules.aging(inv, '2026-07-20'), { balance: 750, daysPastDue: 0, bucket: 'current', overdue: false })
  assert.deepEqual(rules.aging(inv, '2026-08-01'), { balance: 750, daysPastDue: 0, bucket: 'current', overdue: false })
  assert.deepEqual(rules.aging(inv, '2026-08-15'), { balance: 750, daysPastDue: 14, bucket: '1-30', overdue: true })
  assert.equal(rules.aging(inv, '2026-09-15').bucket, '31-60')
  assert.equal(rules.aging(inv, '2026-10-15').bucket, '61-90')
  assert.equal(rules.aging(inv, '2026-12-15').bucket, '90+')
  assert.deepEqual(rules.aging({ ...inv, status: 'Paid', paidAmount: 1000 }, '2026-12-15'), { balance: 0, daysPastDue: 0, bucket: null, overdue: false })
  assert.deepEqual(rules.aging({ ...inv, status: 'Void' }, '2026-12-15'), { balance: 0, daysPastDue: 0, bucket: null, overdue: false })
})

test('the aging summary sums balances by bucket', () => {
  const s = rules.agingSummary([
    { status: 'Open', total: 100, paidAmount: 0, dueDate: '2026-09-20' },
    { status: 'Open', total: 200, paidAmount: 50, dueDate: '2026-08-20' },
    { status: 'Open', total: 300, paidAmount: 0, dueDate: '2026-06-01' },
    { status: 'Paid', total: 999, paidAmount: 999, dueDate: '2026-06-01' },
  ], '2026-09-09')
  assert.equal(s.count, 3)
  assert.equal(s.total, 550)
  assert.equal(s.overdue, 450)
  assert.deepEqual(s.buckets, { current: 100, '1-30': 150, '31-60': 0, '61-90': 0, '90+': 300 })
})

test('a payment moves the balance and closes the invoice when it is covered', () => {
  const inv = { status: 'Open', total: 1000, paidAmount: 250 }
  assert.deepEqual(rules.applyPayment(inv, { amount: 250, paidDate: '2026-09-09' }), {
    errors: [], fields: { paidAmount: 500, paidDate: '2026-09-09', status: 'Open' },
  })
  assert.deepEqual(rules.applyPayment(inv, { amount: '750', paidDate: '2026-09-09' }).fields.status, 'Paid')
  assert.ok(rules.applyPayment(inv, { amount: 750.01, paidDate: '2026-09-09' }).errors[0].startsWith('That is more'))
  assert.ok(rules.applyPayment(inv, { amount: 0, paidDate: '2026-09-09' }).errors.length)
  assert.ok(rules.applyPayment(inv, { amount: 10, paidDate: 'soon' }).errors.length)
  assert.ok(rules.applyPayment({ ...inv, status: 'Void' }, { amount: 10, paidDate: '2026-09-09' }).errors[0].includes('voided'))
  assert.ok(rules.applyPayment({ ...inv, status: 'Paid' }, { amount: 10, paidDate: '2026-09-09' }).errors[0].includes('already'))
})
