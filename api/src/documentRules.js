// ---------------------------------------------------------------------------
// The rules of a document, with no storage and no HTTP in them.
//
// What kinds of paper exist, what a file may be, who may put one on a load
// and who may take one off, and how a blob is named. documents.js asks
// and does the upload; documentRules.test.js checks every branch.
// ---------------------------------------------------------------------------
const crypto = require('node:crypto')

const TYPES = {
  BOL: 'Bill of lading',
  POD: 'Proof of delivery',
  RECEIPT: 'Receipt',
  RATECON: 'Rate confirmation',
  OTHER: 'Other',
}

// What a phone or a scanner produces. A spreadsheet or an executable is
// not paper, and refusing it here is cheaper than storing it.
const CONTENT_TYPES = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/heic': '.heic',
  'image/webp': '.webp',
}

// Phones take 3 MB photos; a scanned multi-page BOL is 1-2 MB. Ten is
// generous, and past it the upload is more likely a mistake than a BOL.
const MAX_BYTES = 10 * 1024 * 1024

// The fields that arrive alongside the file. Returns { errors, doc }.
function validateUpload({ docType, stopId, notes, fileName, contentType, size }) {
  const errors = []
  const doc = {}

  const type = String(docType || '').toUpperCase().trim()
  if (!TYPES[type]) errors.push(`Document type must be one of: ${Object.keys(TYPES).join(', ')}.`)
  else doc.docType = type

  if (stopId === null || stopId === undefined || stopId === '') doc.stopId = null
  else {
    const n = Number(stopId)
    if (!Number.isInteger(n) || n <= 0) errors.push('Stop is not valid.')
    else doc.stopId = n
  }

  const name = String(fileName || '').trim()
  if (!name) errors.push('The file has no name.')
  else doc.fileName = name.slice(0, 200)

  const ct = String(contentType || '').toLowerCase().split(';')[0].trim()
  if (!CONTENT_TYPES[ct]) errors.push('Only PDF, JPEG, PNG, HEIC and WebP files can be attached.')
  else doc.contentType = ct

  const n = Number(size)
  if (!Number.isInteger(n) || n <= 0) errors.push('The file is empty.')
  else if (n > MAX_BYTES) errors.push(`The file is larger than ${MAX_BYTES / 1024 / 1024} MB.`)
  else doc.sizeBytes = n

  const note = notes === null || notes === undefined ? '' : String(notes).trim()
  doc.notes = note ? note.slice(0, 400) : null

  return { errors, doc }
}

// Who may attach paper to a load: dispatch, and the driver on it -- they
// are the one holding the signed POD. Not a driver on another load, and
// nobody on a cancelled load.
function canUpload(user, load) {
  if (!user || !load) return false
  if (load.status === 'Cancelled') return false
  if (user.role === 'dispatcher' || user.role === 'admin') return true
  return user.role === 'driver' && Boolean(user.driverCode) && Boolean(load.driverCode)
    && user.driverCode.toUpperCase() === load.driverCode.toUpperCase()
}

// Who may remove one: dispatch, or whoever uploaded it. A POD that has
// been invoiced against is somebody else's evidence now; dispatch can
// still remove it, a driver cannot.
function canRemove(user, doc, load) {
  if (!user || !doc) return false
  if (user.role === 'dispatcher' || user.role === 'admin') return true
  if (load && load.invoiceNo) return false
  return Boolean(user.email) && Boolean(doc.uploadedBy) && user.email.toLowerCase() === doc.uploadedBy.toLowerCase()
}

// Where the bytes go: the load's own folder, a random name, the right
// extension. Random so a file name from a phone ("IMG_0001.jpg") never
// collides with the next one, and so nothing about the blob name can be
// guessed from the load number.
function blobNameFor(loadId, contentType) {
  const safeLoad = String(loadId).replace(/[^A-Za-z0-9._-]/g, '_')
  return `${safeLoad}/${crypto.randomUUID()}${CONTENT_TYPES[contentType] || ''}`
}

// Which stop a document should be offered against, given its type: a POD
// wants the last delivery, a BOL the first pickup. A hint for the form,
// not a rule.
function suggestedStop(docType, stops) {
  const list = stops || []
  if (list.length === 0) return null
  if (docType === 'POD') return [...list].reverse().find((s) => s.stopType === 'Delivery') || null
  if (docType === 'BOL') return list.find((s) => s.stopType === 'Pickup') || null
  return null
}

module.exports = { TYPES, CONTENT_TYPES, MAX_BYTES, validateUpload, canUpload, canRemove, blobNameFor, suggestedStop }
