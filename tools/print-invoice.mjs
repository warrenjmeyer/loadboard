// ---------------------------------------------------------------------------
// Print an invoice to PDF without a database, a login, or a favour.
//
//   node tools/print-invoice.mjs out.pdf
//
// WHY THIS EXISTS. The printed invoice is the one part of this app that no
// test can see: jsdom has no pages, and @media print only means anything to a
// browser paginating letter paper. So four bugs lived on it until somebody
// printed a real one -- INV-260824-0003, fourteen loads, 2026-09-16 -- and we
// found a blank first page, the totals printed three times, load numbers split
// at their hyphens and live blue hyperlinks on a document going to a
// customer's accounts payable.
//
// This renders the same component against the real styles.css with a fixture
// the shape of that invoice, and prints it through headless Chrome. Run it
// before and after a change to the print CSS and compare the page count and
// the number of times "Balance due" appears -- that is exactly how those four
// were confirmed fixed.
//
// NOTE, and it corrects an older belief in these notes: headless Chrome DOES
// apply @media print through --print-to-pdf. Proven by A/B on 2026-09-16 --
// the pre-fix stylesheet reproduced the blank page and the three totals here,
// and the fixed one did not. What it does NOT drop is background colours, so
// the panels look grey here and white on real paper.
// ---------------------------------------------------------------------------
import { createServer } from 'vite'
import { renderToString } from 'react-dom/server'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CHROME = join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')
const out = resolve(process.argv[2] || 'invoice.pdf')

// The lanes of INV-260824-0003, with L-30001 delivering twice into Chicago --
// the load stops_03_second_consignee.sql split, and the reason the dock lines
// are worth printing at all.
const LANES = [
  ['L-30001', 'Dubuque, IA', 'Chicago, IL', 530, 182, '2026-08-16'],
  ['L-30031', 'Denver, CO', 'Omaha, NE', 1480, 537, '2026-08-16'],
  ['L-30081', 'Kansas City, MO', 'Dallas, TX', 1550, 552, '2026-08-17'],
  ['L-30122', 'Iowa City, IA', 'Milwaukee, WI', 760, 232, '2026-08-18'],
  ['L-30042', 'Denver, CO', 'Omaha, NE', 1515, 537, '2026-08-19'],
  ['L-30143', 'Omaha, NE', 'Dubuque, IA', 1045, 372, '2026-08-19'],
  ['L-30004', 'Omaha, NE', 'Dubuque, IA', 1210, 372, '2026-08-20'],
  ['L-30060', 'Minneapolis, MN', 'Milwaukee, WI', 980, 337, '2026-08-20'],
  ['L-30094', 'Denver, CO', 'Omaha, NE', 1310, 537, '2026-08-20'],
  ['L-31011', 'Louisville, KY', 'Nashville, TN', 516.25, 175, '2026-08-20'],
  ['L-31023', 'Grand Rapids, MI', 'Toledo, OH', 510.4, 176, '2026-08-20'],
  ['L-30082', 'Des Moines, IA', 'Denver, CO', 1800, 670, '2026-08-21'],
  ['L-30101', 'Dallas, TX', 'Memphis, TN', 1265, 452, '2026-08-21'],
  ['L-30103', 'Sioux City, IA', 'Omaha, NE', 375, 95, '2026-08-21'],
]

const lines = []
const stops = []
let n = 0
for (const [loadId, from, to, amount, miles, delivered] of LANES) {
  n += 1
  const ref = (prefix, k) => `${prefix}-${100000 + ((k * 7919) % 900000)}`
  lines.push({
    lineId: n, loadId, lineType: 'LINEHAUL', deliveredDate: delivered, miles, amount,
    description: `${from.toUpperCase()} - ${to.toUpperCase()}`, referenceNo: ref('HEA', n),
  })
  stops.push({ stopId: n * 10 + 1, loadId, seq: 1, stopType: 'Pickup', place: from, name: null, referenceNo: ref('PU', n * 3) })
  if (loadId === 'L-30001') {
    stops.push({ stopId: n * 10 + 2, loadId, seq: 2, stopType: 'Delivery', place: to, name: 'Lakeside Grocery Warehouse', referenceNo: 'PO-LK-48802' })
    stops.push({ stopId: n * 10 + 3, loadId, seq: 3, stopType: 'Delivery', place: to, name: null, referenceNo: 'PO-439149' })
  } else {
    stops.push({ stopId: n * 10 + 2, loadId, seq: 2, stopType: 'Delivery', place: to, name: null, referenceNo: ref('PO', n * 5) })
  }
}

const invoice = {
  invoiceNo: 'INV-260824-0003', customerId: 3, customerName: 'Heartland Building Supply',
  invoiceDate: '2026-08-24', dueDate: '2026-09-23', termsDays: 30,
  billToName: 'Heartland Building Supply', billToAddress: '2900 16th Ave SW, Cedar Rapids, IA 52404',
  status: 'Paid', total: 14846.65, paidAmount: 14846.65, paidDate: '2026-09-20',
  notes: 'Seeded from delivered loads before the app could invoice.',
  customer: { contactName: 'Dana Whitcomb', mcNumber: null },
  lines, stops, documents: [],
}

const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { default: InvoiceDocument } = await vite.ssrLoadModule('/src/components/billing/InvoiceDocument.jsx')
const body = renderToString(React.createElement(MemoryRouter, null, React.createElement(InvoiceDocument, { invoice })))
await vite.close()

const css = readFileSync(join(ROOT, 'src/styles.css'), 'utf8')
const page = join(mkdtempSync(join(tmpdir(), 'invoice-')), 'invoice.html')
writeFileSync(page, `<!doctype html><html><head><meta charset="utf-8"><title>${invoice.invoiceNo}</title>
<style>${css}</style><style>@page { size: letter; margin: 0.5in; }</style></head>
<body><div class="page">${body}</div></body></html>`)

execFileSync(CHROME, ['--headless', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${out}`, `file:///${page.split(String.fromCharCode(92)).join('/')}`], { stdio: 'inherit' })
console.log(`${invoice.invoiceNo} -> ${out}`)
