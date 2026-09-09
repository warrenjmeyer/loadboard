import { useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchJson, patchJson } from '../lib/api.js'
import { fetchMe } from '../lib/auth.js'
import { formatMoney } from '../lib/format.js'
import AccessNotice from '../components/AccessNotice.jsx'
import LoadTable from '../components/LoadTable.jsx'
import CustomerCard from '../components/customers/CustomerCard.jsx'
import CustomerForm, { customerToForm, customerFormToBody, changedCustomerKeys } from '../components/customers/CustomerForm.jsx'
import InvoiceTable, { AgingSummary } from '../components/billing/InvoiceTable.jsx'

// ---------------------------------------------------------------------------
// One customer, at /customers/12: who they are, how to reach them, and every
// load that was theirs -- current first, then delivered.
// ---------------------------------------------------------------------------
export default function CustomerDetail() {
  const { id } = useParams()
  const [user, setUser] = useState(undefined)
  const [customer, setCustomer] = useState(null)
  const [error, setError] = useState(null)
  const [status, setStatus] = useState(null)

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchMe().then((a) => !cancelled && setUser(a)).catch(() => !cancelled && setUser(null))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!user || user.role === 'none') return
    let cancelled = false
    setCustomer(null)
    fetchJson(`/api/customers/${encodeURIComponent(id)}`)
      .then((c) => !cancelled && setCustomer(c))
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setStatus(err.status || null)
      })
    return () => { cancelled = true }
  }, [user, id])

  const canManage = Boolean(user) && (user.role === 'dispatcher' || user.role === 'admin')

  // What they owe. Dispatch and admin only -- the same people who can see
  // /invoices -- and asked for separately so a driver's view of the
  // customer page never even requests it.
  const [billing, setBilling] = useState(null)
  useEffect(() => {
    if (!canManage) return
    let cancelled = false
    setBilling(null)
    fetchJson(`/api/invoices?customer=${encodeURIComponent(id)}`)
      .then((d) => !cancelled && setBilling(d))
      .catch(() => !cancelled && setBilling(null))
    return () => { cancelled = true }
  }, [canManage, id])

  async function handleSave(e) {
    e.preventDefault()
    if (saving) return
    const keys = changedCustomerKeys(customer, form)
    if (keys.length === 0) { setEditing(false); return }
    setSaving(true)
    setFormError(null)
    try {
      const saved = await patchJson(`/api/customers/${customer.customerId}`, customerFormToBody(form, keys))
      setCustomer((c) => ({ ...c, ...saved }))
      setEditing(false)
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (user === undefined) return <div className="page"><p className="muted">Loading...</p></div>
  if (!user) return <AccessNotice status={401} error="Sign in to see customers." />
  if (user.role === 'none') return <AccessNotice status={403} error="Your account is waiting for approval." />
  if (status === 401 || status === 403) return <AccessNotice status={status} error={error} />
  if (status === 404) {
    return (
      <div className="page">
        <h1>No such customer</h1>
        <nav className="board-nav"><Link to="/customers">← Customers</Link></nav>
      </div>
    )
  }
  if (error) return <div className="page"><div className="error">Could not load data: {error}</div></div>
  if (!customer) return <div className="page"><p className="muted">Loading...</p></div>

  const current = customer.loads.filter((l) => l.status !== 'Delivered' && l.status !== 'Cancelled')
  const past = customer.loads.filter((l) => l.status === 'Delivered' || l.status === 'Cancelled')

  return (
    <div className="page">
      <nav className="board-nav board-nav-top">
        <Link to="/customers">← Customers</Link>
        <Link to="/">Load board</Link>
      </nav>

      <CustomerCard customer={customer} />

      {canManage && !editing && (
        <p>
          <button type="button" onClick={() => { setForm(customerToForm(customer)); setFormError(null); setEditing(true) }}>
            Edit customer
          </button>
        </p>
      )}

      {editing && (
        <form className="add-form" onSubmit={handleSave}>
          <h2>Edit {customer.name}</h2>
          {formError && <div className="error">{formError}</div>}
          <fieldset disabled={saving}>
            <CustomerForm form={form} onChange={(n, v) => setForm((f) => ({ ...f, [n]: v }))} />
            <div className="actions">
              <button type="submit" className="primary">{saving ? 'Saving...' : 'Save'}</button>
              <button type="button" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </fieldset>
        </form>
      )}

      {billing && (
        <>
          <h2 className="section-title">Invoices ({billing.invoices.length})</h2>
          <AgingSummary aging={billing.aging} />
          {billing.invoices.length > 0 && <InvoiceTable invoices={billing.invoices} showCustomer={false} />}
        </>
      )}

      <h2 className="section-title">On the board ({current.length})</h2>
      <LoadTable loads={current} />

      <h2 className="section-title">Delivered ({past.length}) · {formatMoney(customer.deliveredRevenue)}</h2>
      <LoadTable loads={past} />
    </div>
  )
}
