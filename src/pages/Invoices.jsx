import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { fetchJson } from '../lib/api.js'
import { fetchMe } from '../lib/auth.js'
import AccessNotice from '../components/AccessNotice.jsx'
import InvoiceTable, { AgingSummary } from '../components/billing/InvoiceTable.jsx'

// ---------------------------------------------------------------------------
// Accounts receivable, at /invoices: what is owed, how late, and by whom.
// Dispatch and admin.
//
// The status filter is a search param, like the board's ?search=, so
// "/invoices?status=Open" is a link somebody can keep.
// ---------------------------------------------------------------------------
const STATUSES = ['', 'Open', 'Paid', 'Void']

export default function Invoices() {
  const [user, setUser] = useState(undefined)
  const [searchParams, setSearchParams] = useSearchParams()
  const status = searchParams.get('status') || ''
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [httpStatus, setHttpStatus] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchMe().then((a) => !cancelled && setUser(a)).catch(() => !cancelled && setUser(null))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!user || user.role === 'none') return
    let cancelled = false
    setData(null)
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    fetchJson(`/api/invoices${params.toString() ? `?${params}` : ''}`)
      .then((d) => !cancelled && setData(d))
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setHttpStatus(err.status || null)
      })
    return () => { cancelled = true }
  }, [user, status])

  if (user === undefined) return <div className="page"><p className="muted">Loading...</p></div>
  if (!user) return <AccessNotice status={401} error="Sign in to see invoices." />
  if (user.role === 'none') return <AccessNotice status={403} error="Your account is waiting for approval." />
  if (user.role === 'driver') return <AccessNotice status={403} error="Invoices are dispatch's to see." />
  if (httpStatus === 401 || httpStatus === 403) return <AccessNotice status={httpStatus} error={error} />

  return (
    <div className="page">
      <nav className="board-nav board-nav-top">
        <Link to="/">← Load board</Link>
        <Link to="/customers">Customers</Link>
        {user.role === 'admin' && <Link to="/billing">Invoice run →</Link>}
      </nav>

      <header>
        <h1>Invoices</h1>
        <p className="sub">
          {data ? `${data.invoices.length} invoice${data.invoices.length === 1 ? '' : 's'}${status ? ` · ${status.toLowerCase()}` : ''}` : 'Loading...'}
        </p>
      </header>

      {error && <div className="error">Could not load data: {error}</div>}

      {data && !status && <AgingSummary aging={data.aging} />}

      <div className="filters">
        <label>
          Status
          <select value={status} onChange={(e) => setSearchParams(e.target.value ? { status: e.target.value } : {})}>
            {STATUSES.map((s) => <option key={s} value={s}>{s || 'All'}</option>)}
          </select>
        </label>
      </div>

      {data && <InvoiceTable invoices={data.invoices} />}
    </div>
  )
}
