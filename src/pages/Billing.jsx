import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fetchJson, postJson } from '../lib/api.js'
import { fetchMe } from '../lib/auth.js'
import { formatMoney, formatDate } from '../lib/format.js'
import AccessNotice from '../components/AccessNotice.jsx'
import InvoiceRunPreview from '../components/billing/InvoiceRunPreview.jsx'

// ---------------------------------------------------------------------------
// The invoice run, at /billing. Admin only.
//
// The pay run's twin: preview, then generate. The GET writes nothing and
// shows exactly what the POST would create; the POST sends the same dates
// back with the customers left ticked. Nothing is billed that was not on
// the screen first.
// ---------------------------------------------------------------------------

// Today, and yesterday: bill everything delivered through yesterday, dated
// today. The server computes the same default; this fills the boxes before
// the first request.
function defaultRun() {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  const iso = (d) => d.toISOString().slice(0, 10)
  const yesterday = new Date(local)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  return { invoiceDate: iso(local), through: iso(yesterday) }
}

export default function Billing() {
  const [user, setUser] = useState(undefined)
  const [run, setRun] = useState(defaultRun)
  const [plan, setPlan] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchMe().then((a) => !cancelled && setUser(a)).catch(() => !cancelled && setUser(null))
    return () => { cancelled = true }
  }, [])

  function setField(e) {
    const { name, value } = e.target
    setRun((r) => ({ ...r, [name]: value }))
    setPlan(null)
    setResult(null)
  }

  async function handlePreview(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const p = await fetchJson(`/api/invoicerun?${new URLSearchParams(run)}`)
      setPlan(p)
      setSelected(new Set(p.invoices.map((i) => i.customerId)))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function toggle(id) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleGenerate() {
    if (busy || !plan || selected.size === 0) return
    setBusy(true)
    setError(null)
    try {
      const r = await postJson('/api/invoicerun', { ...run, customerIds: [...selected] })
      setResult(r)
      setPlan(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (user === undefined) return <div className="page"><p className="muted">Loading...</p></div>
  if (!user) return <AccessNotice status={401} error="Sign in to bill." />
  if (user.role !== 'admin') return <AccessNotice status={403} error="Only an administrator can run billing." />

  const chosenTotal = plan ? plan.invoices.filter((i) => selected.has(i.customerId)).reduce((t, i) => t + i.total, 0) : 0

  return (
    <div className="page">
      <nav className="board-nav board-nav-top">
        <Link to="/invoices">← Invoices</Link>
        <Link to="/customers">Customers</Link>
        <Link to="/">Load board</Link>
      </nav>

      <header>
        <h1>Invoice run</h1>
        <p className="sub">Delivered loads that have not been billed become invoices, one per customer. Preview first; nothing is written until you generate.</p>
      </header>

      <form className="filters" onSubmit={handlePreview}>
        <label>
          Delivered through
          <input type="date" name="through" value={run.through} onChange={setField} required />
        </label>
        <label>
          Invoice date
          <input type="date" name="invoiceDate" value={run.invoiceDate} onChange={setField} required />
        </label>
        <button type="submit" className="primary" disabled={busy}>{busy && !plan ? 'Working...' : 'Preview'}</button>
      </form>

      {error && <div className="error">{error}</div>}

      {plan && (
        <>
          <p className="muted hint">
            Everything delivered on or before {formatDate(plan.through)} and not yet on an invoice, at the load's rate,
            plus every charge marked bill-to-customer. Untick a customer to leave them for the next run.
          </p>
          <InvoiceRunPreview plan={plan} selected={selected} onToggle={toggle} />
          {plan.invoices.length > 0 && (
            <p className="actions">
              <button type="button" className="primary" onClick={handleGenerate} disabled={busy || selected.size === 0}>
                {busy ? 'Generating...' : `Generate ${selected.size} invoice${selected.size === 1 ? '' : 's'} · ${formatMoney(chosenTotal)}`}
              </button>
            </p>
          )}
          {plan.unlinkedLoads > 0 && (
            <p className="muted hint">
              {plan.unlinkedLoads} delivered load{plan.unlinkedLoads === 1 ? ' has' : 's have'} a typed customer name and no customer
              record, so a run cannot bill {plan.unlinkedLoads === 1 ? 'it' : 'them'}. Open the load, pick the customer, and preview again.
            </p>
          )}
        </>
      )}

      {result && (
        <>
          <h2 className="section-title">Created · dated {formatDate(result.invoiceDate)}</h2>
          <ul className="payrun-created">
            {result.created.map((c) => (
              <li key={c.invoiceNo}>
                <Link to={`/invoices/${encodeURIComponent(c.invoiceNo)}`} className="mono">{c.invoiceNo}</Link>
                {' · '}{c.customerName}{' · '}{c.loadCount} load{c.loadCount === 1 ? '' : 's'}
                {c.chargeCount ? <> and {c.chargeCount} charge{c.chargeCount === 1 ? '' : 's'}</> : null}
                {' · '}<strong>{formatMoney(c.total)}</strong>{' · due '}{formatDate(c.dueDate)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
