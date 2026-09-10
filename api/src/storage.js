// ---------------------------------------------------------------------------
// The blob store, where the paper lives.
//
// One container, private, named by STORAGE_CONTAINER (default "documents")
// in the account STORAGE_CONNECTION points at. Nothing in the browser ever
// holds the connection string: the API uploads on the browser's behalf,
// and to let the browser VIEW a file it mints a signed URL that is good
// for a few minutes and for that one blob -- the same idea as a hotel
// key card. The container never becomes public.
//
// Like geotab.js, "not configured" is a state the routes turn into a 503
// that says so, not a stack trace from the SDK.
// ---------------------------------------------------------------------------
const { BlobServiceClient, StorageSharedKeyCredential, generateBlobSASQueryParameters, BlobSASPermissions } = require('@azure/storage-blob')

function settings() {
  return {
    connection: process.env.STORAGE_CONNECTION || '',
    container: process.env.STORAGE_CONTAINER || 'documents',
  }
}

function configured() {
  return Boolean(settings().connection)
}

// The account name and key, pulled out of the connection string, because
// signing a URL needs them as a credential object and the SDK does not
// expose the one it parsed.
function credentialFrom(connection) {
  const parts = Object.fromEntries(connection.split(';').filter(Boolean).map((kv) => {
    const i = kv.indexOf('=')
    return [kv.slice(0, i), kv.slice(i + 1)]
  }))
  if (!parts.AccountName || !parts.AccountKey) throw new Error('STORAGE_CONNECTION has no AccountName/AccountKey')
  return new StorageSharedKeyCredential(parts.AccountName, parts.AccountKey)
}

let clients = null

function get() {
  if (!configured()) throw new Error('Blob storage is not configured')
  if (!clients) {
    const s = settings()
    const service = BlobServiceClient.fromConnectionString(s.connection)
    clients = {
      container: service.getContainerClient(s.container),
      credential: credentialFrom(s.connection),
      containerName: s.container,
    }
  }
  return clients
}

// Create the container if it is missing, private. Done once per warm
// instance, so a fresh storage account works without a portal step.
let ensured = null
function ensureContainer() {
  if (!ensured) {
    ensured = get().container.createIfNotExists().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}

async function upload(blobName, buffer, contentType) {
  await ensureContainer()
  const blob = get().container.getBlockBlobClient(blobName)
  await blob.uploadData(buffer, { blobHTTPHeaders: { blobContentType: contentType } })
  return blobName
}

async function remove(blobName) {
  const blob = get().container.getBlockBlobClient(blobName)
  await blob.deleteIfExists()
}

// A URL that opens this one blob for the next few minutes and nothing
// else. Read-only. The content-disposition makes the browser show the
// file under the name it was uploaded as, not the storage name.
function viewUrl(blobName, fileName, { minutes = 10, inline = true } = {}) {
  const { container, credential, containerName } = get()
  const expiresOn = new Date(Date.now() + minutes * 60000)
  const disposition = `${inline ? 'inline' : 'attachment'}; filename="${String(fileName).replace(/["\r\n]/g, '')}"`
  const sas = generateBlobSASQueryParameters({
    containerName,
    blobName,
    permissions: BlobSASPermissions.parse('r'),
    startsOn: new Date(Date.now() - 5 * 60000),
    expiresOn,
    contentDisposition: disposition,
  }, credential).toString()
  return `${container.getBlockBlobClient(blobName).url}?${sas}`
}

// For tests and for a rotated key: forget the cached clients.
function forget() {
  clients = null
  ensured = null
}

module.exports = { configured, settings, upload, remove, viewUrl, ensureContainer, forget }
