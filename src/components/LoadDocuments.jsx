import { useState } from 'react'

// ---------------------------------------------------------------------------
// The paper on a load: what is attached, and a form to attach more.
//
// Presentational plus one piece of local state (the form draft), like
// LoadCharges. `documents` come from GET /api/loads/{id}/documents, each
// with a viewUrl minted for this request; `stops` let the form say which
// dock a POD was signed at; `canUpload` and `canRemove` come from the page,
// which mirrors the server's rules only so the controls are absent rather
// than present-and-refusing.
//
// The view link is a plain <a> that opens in a new tab: it leaves the app
// for the storage account, and the URL is good for ten minutes, which is
// why the list is re-fetched rather than cached.
// ---------------------------------------------------------------------------
const TYPES = [
  ['POD', 'Proof of delivery'],
  ['BOL', 'Bill of lading'],
  ['RECEIPT', 'Receipt'],
  ['RATECON', 'Rate confirmation'],
  ['OTHER', 'Other'],
]

const when = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function size(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// A POD belongs at the last delivery, a BOL at the first pickup. A
// suggestion the form pre-selects; the user can change it.
function suggestedStop(docType, stops) {
  if (!stops || stops.length === 0) return ''
  if (docType === 'POD') return String([...stops].reverse().find((s) => s.stopType === 'Delivery')?.stopId ?? '')
  if (docType === 'BOL') return String(stops.find((s) => s.stopType === 'Pickup')?.stopId ?? '')
  return ''
}

export default function LoadDocuments({ documents, stops = [], canUpload = false, canRemove = () => false, onUpload, onRemove, notConnected = false }) {
  const [adding, setAdding] = useState(false)
  const [docType, setDocType] = useState('POD')
  const [stopId, setStopId] = useState(() => suggestedStop('POD', stops))
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  if (notConnected) {
    return <p className="muted small">Document storage is not connected on this server, so nothing can be attached yet.</p>
  }

  function pickType(t) {
    setDocType(t)
    setStopId(suggestedStop(t, stops))
  }

  async function submit(e) {
    e.preventDefault()
    if (busy || !file) return
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file, file.name)
      form.append('docType', docType)
      if (stopId) form.append('stopId', stopId)
      if (notes.trim()) form.append('notes', notes.trim())
      await onUpload(form)
      setAdding(false)
      setFile(null)
      setNotes('')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onRemove(id)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="documents">
      {error && <div className="error">{error}</div>}

      {documents.length === 0
        ? <p className="muted">Nothing attached yet.</p>
        : (
          <ul className="document-list">
            {documents.map((d) => (
              <li key={d.documentId} className="document">
                <span className={`badge badge-doc-${d.docType.toLowerCase()}`}>{d.docTypeLabel}</span>
                <a href={d.viewUrl || `/api/documents/${d.documentId}`} target="_blank" rel="noreferrer">{d.fileName}</a>
                <span className="muted small"> · {size(d.sizeBytes)}</span>
                {d.stopSeq && <span className="muted small"> · stop {d.stopSeq}, {d.stopPlace}</span>}
                {d.notes && <span className="muted small"> · {d.notes}</span>}
                <span className="muted small"> · {d.uploadedBy || ''}{d.uploadedUtc ? ` ${when.format(new Date(`${d.uploadedUtc}Z`))}` : ''}</span>
                {canRemove(d) && (
                  <button type="button" className="linklike small" disabled={busy} onClick={() => remove(d.documentId)}>Remove</button>
                )}
              </li>
            ))}
          </ul>
        )}

      {canUpload && !adding && (
        <p><button type="button" onClick={() => setAdding(true)}>+ Attach a document</button></p>
      )}

      {adding && (
        <form className="add-form" onSubmit={submit}>
          <h2>Attach a document</h2>
          <fieldset disabled={busy}>
            <div className="dispatch-row">
              <label>
                What is it
                <select value={docType} onChange={(e) => pickType(e.target.value)}>
                  {TYPES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
              </label>
              {stops.length > 0 && (
                <label>
                  At which stop
                  <select value={stopId} onChange={(e) => setStopId(e.target.value)}>
                    <option value="">Whole load</option>
                    {stops.map((s) => <option key={s.stopId} value={s.stopId}>{s.seq}. {s.stopType} · {s.place}</option>)}
                  </select>
                </label>
              )}
              <label>
                Notes
                <input type="text" maxLength={400} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="signed by receiver" />
              </label>
            </div>
            <div className="dispatch-row">
              <label>
                File
                {/* accept + capture: on a phone this offers the camera straight
                    away, which is how a POD actually gets photographed. */}
                <input type="file" accept="application/pdf,image/jpeg,image/png,image/heic,image/webp" capture="environment"
                  onChange={(e) => setFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)} required />
              </label>
            </div>
            <p className="muted hint">PDF or a photo, up to 10 MB.</p>
            <div className="actions">
              <button type="submit" className="primary" disabled={!file}>{busy ? 'Uploading...' : 'Attach'}</button>
              <button type="button" onClick={() => { setAdding(false); setError(null) }}>Cancel</button>
            </div>
          </fieldset>
        </form>
      )}
    </div>
  )
}
