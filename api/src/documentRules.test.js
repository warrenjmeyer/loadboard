const test = require('node:test')
const assert = require('node:assert/strict')
const rules = require('./documentRules')

const GOOD = { docType: 'pod', stopId: '3', notes: ' signed by receiver ', fileName: 'IMG_0412.jpg', contentType: 'image/jpeg', size: 2_400_000 }

test('a phone photo of a signed POD is accepted and normalised', () => {
  const { errors, doc } = rules.validateUpload(GOOD)
  assert.deepEqual(errors, [])
  assert.deepEqual(doc, { docType: 'POD', stopId: 3, fileName: 'IMG_0412.jpg', contentType: 'image/jpeg', sizeBytes: 2_400_000, notes: 'signed by receiver' })
})

test('a PDF with no stop and no notes is fine too', () => {
  const { errors, doc } = rules.validateUpload({ docType: 'RATECON', stopId: '', notes: '', fileName: 'ratecon.pdf', contentType: 'application/pdf; charset=binary', size: 90_000 })
  assert.deepEqual(errors, [])
  assert.equal(doc.stopId, null)
  assert.equal(doc.notes, null)
  assert.equal(doc.contentType, 'application/pdf')
})

test('the wrong kind of file, an empty one, or a huge one is refused', () => {
  assert.ok(rules.validateUpload({ ...GOOD, contentType: 'application/vnd.ms-excel' }).errors[0].includes('Only PDF'))
  assert.ok(rules.validateUpload({ ...GOOD, size: 0 }).errors[0].includes('empty'))
  assert.ok(rules.validateUpload({ ...GOOD, size: rules.MAX_BYTES + 1 }).errors[0].includes('larger than 10 MB'))
  assert.ok(rules.validateUpload({ ...GOOD, docType: 'SELFIE' }).errors[0].includes('Document type'))
  assert.ok(rules.validateUpload({ ...GOOD, stopId: 'x' }).errors[0].includes('Stop'))
  assert.ok(rules.validateUpload({ ...GOOD, fileName: '' }).errors[0].includes('no name'))
})

const DISPATCH = { role: 'dispatcher', email: 'd@x' }
const DRIVER = { role: 'driver', driverCode: 'JSMITH', email: 'js@x' }
const OTHER = { role: 'driver', driverCode: 'SOAKS', email: 'so@x' }
const LOAD = { status: 'In Transit', driverCode: 'JSMITH', invoiceNo: null }

test('dispatch and the driver on the load may upload; nobody on a cancelled load', () => {
  assert.equal(rules.canUpload(DISPATCH, LOAD), true)
  assert.equal(rules.canUpload(DRIVER, LOAD), true)
  assert.equal(rules.canUpload(OTHER, LOAD), false)
  assert.equal(rules.canUpload(null, LOAD), false)
  assert.equal(rules.canUpload(DISPATCH, { ...LOAD, status: 'Cancelled' }), false)
  assert.equal(rules.canUpload({ role: 'none' }, LOAD), false)
})

test('dispatch, or the uploader, may remove -- unless the load has been invoiced', () => {
  const doc = { uploadedBy: 'JS@x' }
  assert.equal(rules.canRemove(DISPATCH, doc, LOAD), true)
  assert.equal(rules.canRemove(DRIVER, doc, LOAD), true)
  assert.equal(rules.canRemove(OTHER, doc, LOAD), false)
  assert.equal(rules.canRemove(DRIVER, doc, { ...LOAD, invoiceNo: 'INV-260910-0001' }), false)
  assert.equal(rules.canRemove(DISPATCH, doc, { ...LOAD, invoiceNo: 'INV-260910-0001' }), true)
})

test('a blob name is the load folder, a random name, the right extension', () => {
  const name = rules.blobNameFor('L-10416', 'image/jpeg')
  assert.match(name, /^L-10416\/[0-9a-f-]{36}\.jpg$/)
  assert.notEqual(name, rules.blobNameFor('L-10416', 'image/jpeg'))
  assert.match(rules.blobNameFor('weird id!', 'application/pdf'), /^weird_id_\/[0-9a-f-]{36}\.pdf$/)
})

test('a POD suggests the last delivery, a BOL the first pickup', () => {
  const stops = [
    { stopId: 1, stopType: 'Pickup' }, { stopId: 2, stopType: 'Delivery' }, { stopId: 3, stopType: 'Delivery' },
  ]
  assert.equal(rules.suggestedStop('POD', stops).stopId, 3)
  assert.equal(rules.suggestedStop('BOL', stops).stopId, 1)
  assert.equal(rules.suggestedStop('RECEIPT', stops), null)
  assert.equal(rules.suggestedStop('POD', []), null)
})
