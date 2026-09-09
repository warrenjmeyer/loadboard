import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fetchJson, postJson, patchJson } from '../lib/api.js'
import { fetchMe } from '../lib/auth.js'
import { formatMoney } from '../lib/format.js'
import AccessNotice from '../components/AccessNotice.jsx'
import CustomerTable from '../components/customers/CustomerTable.jsx'
import CustomerForm, { BLANK_CUSTOMER, customerToForm, customerFormToBody, changedCustomerKeys } from '../components/customers/CustomerForm.jsx'

// ---------------------------------------------------------------------------
// Customers, at /customers: who the freight belongs to, what they owe in
// terms, and whether dispatch may take their loads. Same shape as /fleet --
// a table, one editor open at a time, edits for dispatch only.
// ---------------------------------------------------------------------------
export default function Customers() {
  const [user, setUser] = useState(undefined)
  const [customers, setCustomers] = useState(null)
  const [error, setError] = useState(null)
  const [status, setStatus] = useState(null)

  const [editing, setEditing] = useState(null)   // null | { id: number|null }
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchMe().then((a) => !cancelled && setUser(a)).catch(() => !cancelled && setUser(null))
    return () => { cancelled = true }
  }, [])

  const canManage = Boolean(user) && (user.role === 'dispatcher' || user.role === 'admin')

  useEffect(() => {
    if (!user || user.role === 'none') return
    let cancelled = false
    fetchJson('/api/customers')
      .then((rows) => !cancelled && setCustomers(rows))
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setStatus(err.status || null)
      })
    return () => { cancelled = true }
  }, [user])

  function openEditor(id) {
    setFormError(null)
    setForm(id ? customerToForm(customers.find((c) => c.customerId === id)) : BLANK_CUSTOMER)
    setEditing({ id })
  }

  function closeEditor() {
    setEditing(null)
    setForm(null)
    setFormError(null)
  }

  async function handleSave(e) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    setFormError(null)
    try {
      let saved
      if (editing.id) {
        const keys = changedCustomerKeys(customers.find((c) => c.customerId === editing.id), form)
        if (keys.length === 0) { closeEditor(); return }
        saved = await patchJson(`/api/customers/${editing.id}`, customerFormToBody(form, keys))
        setCustomers((list) => list.map((c) => (c.customerId === saved.customerId ? saved : c)))
      } else {
        saved = await postJson('/api/customers', customerFormToBody(form))
        setCustomers((list) => [...list, saved])
      }
      closeEditor()
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

  const onHold = (customers || []).filter((c) => c.status === 'Hold')
  const billed = (customers || []).reduce((s, c) => s + c.deliveredRevenue, 0)

  return (
    <div className="page">
      <nav className="board-nav board-nav-top">
        <Link to="/">← Load board</Link>
      </nav>

      <header>
        <h1>Customers</h1>
        <p className="sub">
          {customers
            ? `${customers.length} customers · ${formatMoney(billed)} billed on delivered loads`
            : 'Loading...'}
        </p>
      </header>

      {error && <div className="error">Could not load data: {error}</div>}

      {onHold.length > 0 && (
        <ul className="fleet-alerts">
          {onHold.map((c) => (
            <li key={c.customerId} className="due-past">
              <Link to={`/customers/${c.customerId}`}>{c.name}</Link> is on hold
              {c.currentLoads ? ` with ${c.currentLoads} load${c.currentLoads === 1 ? '' : 's'} on the board` : ''}.
              {c.notes ? ` ${c.notes}` : ''}
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <form className="add-form" onSubmit={handleSave}>
          <h2>{editing.id ? `Edit ${form.name}` : 'New customer'}</h2>
          {formError && <div className="error">{formError}</div>}
          <fieldset disabled={saving}>
            <CustomerForm form={form} onChange={(n, v) => setForm((f) => ({ ...f, [n]: v }))} />
            <div className="actions">
              <button type="submit" className="primary">{saving ? 'Saving...' : 'Save'}</button>
              <button type="button" onClick={closeEditor}>Cancel</button>
            </div>
          </fieldset>
        </form>
      )}

      {customers && <CustomerTable customers={customers} onEdit={canManage ? openEditor : null} />}
      {canManage && !editing && customers && (
        <p><button type="button" onClick={() => openEditor(null)}>+ Add customer</button></p>
      )}
    </div>
  )
}
