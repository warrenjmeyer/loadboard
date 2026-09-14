// ---------------------------------------------------------------------------
// node --test
//
// The rearranging behind the printed invoice. Every case here is one where the
// page would still render -- the failure is a wrong or missing NUMBER on a
// document that goes to a customer's accounts payable department, which is
// exactly the kind of bug nobody notices until the invoice is disputed.
// ---------------------------------------------------------------------------
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupInvoice, loadsMissingPod, loadsWithPod } from './invoicePaper.js'

const invoice = {
  lines: [
    { lineId: 1, loadId: 'L-10416', lineType: 'LINEHAUL', description: 'WATERLOO, IA - MINNEAPOLIS, MN', amount: 700, deliveredDate: '2026-09-09', referenceNo: 'PO-77', miles: 246 },
    { lineId: 2, loadId: 'L-10416', lineType: 'CHARGE', description: 'DETENTION - 2 HRS', amount: 150, deliveredDate: '2026-09-09', referenceNo: 'PO-77', miles: 246 },
    { lineId: 3, loadId: 'L-30012', lineType: 'CHARGE', description: 'STOP-OFF', amount: 75, deliveredDate: '2026-08-20', referenceNo: null, miles: 180 },
  ],
  stops: [
    // Deliberately out of sequence and interleaved between loads, the way a
    // second ORDER BY column would leave them if the first were wrong.
    { stopId: 22, loadId: 'L-10416', seq: 2, stopType: 'Delivery', place: 'Minneapolis, MN', name: 'Cub Foods DC', referenceNo: 'PO-99120' },
    { stopId: 31, loadId: 'L-30012', seq: 1, stopType: 'Pickup', place: 'Dubuque, IA', name: null, referenceNo: null },
    { stopId: 21, loadId: 'L-10416', seq: 1, stopType: 'Pickup', place: 'Waterloo, IA', name: 'Tyson Foods', referenceNo: 'PU-4412' },
    { stopId: 32, loadId: 'L-30012', seq: 2, stopType: 'Delivery', place: 'Chicago, IL', name: null, referenceNo: null },
  ],
  documents: [
    { documentId: 5, loadId: 'L-10416', stopId: 22, docType: 'POD', fileName: 'pod-cub.pdf' },
    { documentId: 6, loadId: 'L-10416', stopId: null, docType: 'BOL', fileName: 'bol.pdf' },
  ],
}

test('groups lines by load, line haul apart from its charges', () => {
  const groups = groupInvoice(invoice)
  assert.deepEqual(groups.map((g) => g.loadId), ['L-10416', 'L-30012'])
  assert.equal(groups[0].linehaul.amount, 700)
  assert.deepEqual(groups[0].charges.map((c) => c.description), ['DETENTION - 2 HRS'])
  // A straggler charge whose load was billed earlier has no line haul here.
  assert.equal(groups[1].linehaul, null)
  assert.equal(groups[1].charges.length, 1)
})

test('stops land on their own load, in the order they were driven', () => {
  const [first, second] = groupInvoice(invoice)
  assert.deepEqual(first.stops.map((s) => s.seq), [1, 2])
  assert.deepEqual(first.stops.map((s) => s.place), ['Waterloo, IA', 'Minneapolis, MN'])
  assert.deepEqual(second.stops.map((s) => s.stopId), [31, 32])
})

test('each dock keeps its own reference number', () => {
  // The whole point: the load says PO-77 and the consignee says PO-99120.
  // Printing PO-77 against the delivery is what sends AP looking for a
  // purchase order they never raised.
  const [first] = groupInvoice(invoice)
  assert.equal(first.referenceNo, 'PO-77')
  assert.deepEqual(first.stops.map((s) => s.referenceNo), ['PU-4412', 'PO-99120'])
})

test('a POD signed at a dock marks that dock and no other', () => {
  const [first] = groupInvoice(invoice)
  assert.equal(first.stops[0].pod, null)
  assert.equal(first.stops[1].pod.fileName, 'pod-cub.pdf')
  assert.deepEqual(first.pods.map((d) => d.documentId), [5])
  assert.equal(first.documents.length, 2)
})

test('a POD with no stop counts for the load without marking a dock', () => {
  const groups = groupInvoice({
    ...invoice,
    documents: [{ documentId: 9, loadId: 'L-10416', stopId: null, docType: 'POD', fileName: 'pod-photo.jpg' }],
  })
  assert.deepEqual(groups[0].stops.map((s) => s.pod), [null, null])
  assert.equal(groups[0].pods.length, 1)
  assert.deepEqual(loadsMissingPod(groups), [])
})

test('stops print only when they add something to the lane', () => {
  const [first, second] = groupInvoice(invoice)
  assert.equal(first.showStops, true)
  // L-30012's two stops are its origin and destination with no dock name, no
  // reference and no paper: printing them repeats the description above.
  assert.equal(second.showStops, false)
})

test('missing proof of delivery is reported for hauled loads only', () => {
  const groups = groupInvoice(invoice)
  // L-30012 is a straggler charge -- we did not bill the haul here, so its
  // POD is not this invoice's problem.
  assert.deepEqual(loadsMissingPod(groups), [])
  assert.deepEqual(loadsWithPod(groups), ['L-10416'])

  const none = groupInvoice({ ...invoice, documents: [] })
  assert.deepEqual(loadsMissingPod(none), ['L-10416'])
  assert.deepEqual(loadsWithPod(none), [])
})

test('an invoice from a database without the stop or document tables still groups', () => {
  // The API guards both SELECTs on OBJECT_ID, so these arrive empty rather
  // than absent -- but a payload cached by a browser from before the change
  // has neither key at all.
  const groups = groupInvoice({ lines: invoice.lines })
  assert.equal(groups.length, 2)
  assert.deepEqual(groups[0].stops, [])
  assert.deepEqual(groups[0].documents, [])
  assert.equal(groups[0].showStops, false)
  assert.deepEqual(groupInvoice({}), [])
  assert.deepEqual(groupInvoice(null), [])
})
