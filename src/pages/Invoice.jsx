import { useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchJson, patchJson } from '../lib/api.js'
import { fetchMe } from '../lib/auth.js'
import { formatMoney, formatDate } from '../lib/format.js'
import AccessNotice from '../components/AccessNotice.jsx'
import InvoiceDocument from '../components/billing/InvoiceDocument.jsx'

// ---------------------------------------------------------------------------
// One invoice, at /invoices/INV-260910-0001: the document, and above it the
// two things an admin does to one -- record a payment, or void it.
//
// The toolbar and the forms carry the settlement's stmt-toolbar class, so
// printing hides them and leaves the document (see @media print in
// styles.css). "Print" here is how an invoice becomes a PDF to send.
// ---------------------------------------------------------------------------
export default function Invoice() {
  const { invoiceNo } = useParams()
  const [user, setUser] = useState(undefined)
  const [invoice, setInvoice] = useState(null)
  const [error, setError] = useState(null)
  const [status, setStatus] = useState(null)

  const [paying, setPaying] = useState(false)
  const [payment, setPayment] = useState({ amount: '', paidDate: new Date().toISOString().slice(0, 10) })
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchMe().then((a) => !cancelled && setUser(a)).catch(() => !cancelled && setUser(null))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!user || user.role === 'none') return
    let cancelled = false
    setInvoice(null)
    fetchJson(`/api/invoices/${encodeURIComponent(invoiceNo)}`)
      .then((i) => {
        if (cancelled) return
        setInvoice(i)
        setPayment((p) => ({ ...p, amount: String(Math.round((i.total - i.paidAmount) * 100) / 100) }))
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setStatus(err.status || null)
      })
    return () => { cancelled = true }
  }, [user, invoiceNo])

  async function handlePay(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setActionError(null)
    try {
      const saved = await patchJson(`/api/invoices/${encodeURIComponent(invoiceNo)}`, { payment: { amount: Number(payment.amount), paidDate: payment.paidDate } })
      setInvoice((i) => ({ ...i, ...saved }))
      setPaying(false)
    } catch (err) {
      setActionError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleVoid(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setActionError(null)
    try {
      const saved = await patchJson(`/api/invoices/${encodeURIComponent(invoiceNo)}`, { status: 'Void', reason })
      setInvoice((i) => ({ ...i, ...saved }))
      setVoiding(false)
    } catch (err) {
      setActionError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (user === undefined) return <div className="page"><p className="muted">Loading...</p></div>
  if (!user) return <AccessNotice status={401} error="Sign in to see invoices." />
  if (user.role === 'none') return <AccessNotice status={403} error="Your account is waiting for approval." />
  if (user.role === 'driver') return <AccessNotice status={403} error="Invoices are dispatch's to see." />
  if (status === 401 || status === 403) return <AccessNotice status={status} error={error} />
  if (status === 404) {
    return (
      <div className="page">
        <h1>No such invoice</h1>
        <nav className="board-nav"><Link to="/invoices">← Invoices</Link></nav>
      </div>
    )
  }
  if (error) return <div className="page"><div className="error">Could not load data: {error}</div></div>
  if (!invoice) return <div className="page"><p className="muted">Loading...</p></div>

  const isAdmin = user.role === 'admin'
  const balance = Math.round((invoice.total - invoice.paidAmount) * 100) / 100

  return (
    <div className="page stmt">
      <div className="stmt-toolbar">
        <nav className="stmt-back">
          <Link to="/invoices">← Invoices</Link>
          <Link to={`/customers/${invoice.customerId}`}>{invoice.customerName}</Link>
          <Link to="/">Load board</Link>
        </nav>
        <div className="actions">
          {isAdmin && invoice.status === 'Open' && !paying && !voiding && (
            <>
              <button type="button" className="primary" onClick={() => setPaying(true)}>Record payment</button>
              {invoice.paidAmount === 0 && <button type="button" onClick={() => setVoiding(true)}>Void</button>}
            </>
          )}
          <button type="button" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      {invoice.status === 'Open' && invoice.overdue && (
        <p className="stmt-toolbar due-past">
          {invoice.daysPastDue} days past due · {formatMoney(balance)} outstanding
        </p>
      )}

      {actionError && <div className="error stmt-toolbar">{actionError}</div>}

      {paying && (
        <form className="add-form stmt-toolbar" onSubmit={handlePay}>
          <h2>Record a payment on {invoice.invoiceNo}</h2>
          <fieldset disabled={busy}>
            <div className="filters">
              <label>
                Amount
                <input type="number" step="0.01" min="0.01" max={balance} value={payment.amount}
                  onChange={(e) => setPayment((p) => ({ ...p, amount: e.target.value }))} required />
              </label>
              <label>
                Received
                <input type="date" value={payment.paidDate}
                  onChange={(e) => setPayment((p) => ({ ...p, paidDate: e.target.value }))} required />
              </label>
            </div>
            <p className="muted hint">{formatMoney(balance)} is outstanding. A payment that covers it marks the invoice paid.</p>
            <div className="actions">
              <button type="submit" className="primary">{busy ? 'Saving...' : 'Save payment'}</button>
              <button type="button" onClick={() => setPaying(false)}>Cancel</button>
            </div>
          </fieldset>
        </form>
      )}

      {voiding && (
        <form className="add-form stmt-toolbar" onSubmit={handleVoid}>
          <h2>Void {invoice.invoiceNo}</h2>
          <p className="muted hint">
            The number stays on record and the loads and charges on it become billable again on the next run.
          </p>
          <fieldset disabled={busy}>
            <label>
              Reason
              <input type="text" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Wrong rate on L-10416" />
            </label>
            <div className="actions">
              <button type="submit" className="danger">{busy ? 'Voiding...' : 'Void invoice'}</button>
              <button type="button" onClick={() => setVoiding(false)}>Cancel</button>
            </div>
          </fieldset>
        </form>
      )}

      <InvoiceDocument invoice={invoice} />

      {/* The paper behind the lines, for the person sending the invoice:
          a customer's AP asks for the signed POD before paying. Off the
          printed page (stmt-toolbar hides in print); each link opens the
          file through the API, which mints a short-lived URL. */}
      {invoice.documents && invoice.documents.length > 0 && (
        <div className="stmt-toolbar invoice-docs">
          <h2 className="section-title">Attached paper</h2>
          <ul className="document-list">
            {invoice.documents.map((d) => (
              <li key={d.documentId} className="document">
                <Link className="mono" to={`/loads/${encodeURIComponent(d.loadId)}`}>{d.loadId}</Link>
                <span className={`badge badge-doc-${d.docType.toLowerCase()}`}>{d.docType}</span>
                <a href={`/api/documents/${d.documentId}`} target="_blank" rel="noreferrer">{d.fileName}</a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {invoice.documents && invoice.documents.length === 0 && invoice.status === 'Open' && (
        <p className="muted hint stmt-toolbar">No proof of delivery is attached to the loads on this invoice yet.</p>
      )}

      {invoice.status === 'Paid' && (
        <p className="muted hint stmt-toolbar">Paid {formatDate(invoice.paidDate)}.</p>
      )}
    </div>
  )
}
