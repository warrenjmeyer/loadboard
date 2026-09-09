import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fetchJson, postJson, patchJson } from '../lib/api.js'
import { fetchMe } from '../lib/auth.js'
import AccessNotice from '../components/AccessNotice.jsx'
import TruckTable from '../components/fleet/TruckTable.jsx'
import TrailerTable from '../components/fleet/TrailerTable.jsx'
import TruckForm, { BLANK_TRUCK, truckToForm, truckFormToBody } from '../components/fleet/TruckForm.jsx'
import TrailerForm, { BLANK_TRAILER, trailerToForm, trailerFormToBody } from '../components/fleet/TrailerForm.jsx'

// ---------------------------------------------------------------------------
// The fleet, at /fleet: every truck and trailer, what it is on, and what is
// about to expire.
//
// Readable by anyone with a role; editable by dispatch. The edit affordances
// come from the same `manageFleet` rule the server enforces, mirrored here
// only so the buttons are absent rather than present-and-refusing.
//
// One page, two lists, one editor open at a time. The editor is keyed by
// kind + number so clicking Edit on a second row replaces the first rather
// than stacking forms down the page.
// ---------------------------------------------------------------------------

// Anything expiring inside a month, or already expired, floats to the top of
// the page as a list of sentences. A dispatcher does not scan two tables for
// amber cells; they read three lines and make three phone calls.
function warnings(trucks, trailers) {
  const out = []
  const add = (what, label, iso, days) => {
    if (days === null || days === undefined || days > 30) return
    out.push({ key: `${what}-${label}`, days, text: `${what}: ${label} ${days < 0 ? `expired ${-days} days ago` : days === 0 ? 'expires today' : `expires in ${days} days`}` })
  }
  for (const t of trucks) {
    if (t.status === 'Retired') continue
    add(`Truck ${t.unitNo}`, 'registration', t.registrationExpires, t.registrationDays)
    add(`Truck ${t.unitNo}`, 'inspection', t.inspectionDue, t.inspectionDays)
  }
  for (const t of trailers) {
    if (t.status === 'Retired') continue
    add(`Trailer ${t.trailerNo}`, 'registration', t.registrationExpires, t.registrationDays)
    add(`Trailer ${t.trailerNo}`, 'inspection', t.inspectionDue, t.inspectionDays)
  }
  return out.sort((a, b) => a.days - b.days)
}

export default function Fleet() {
  const [user, setUser] = useState(undefined)
  const [trucks, setTrucks] = useState(null)
  const [trailers, setTrailers] = useState(null)
  const [drivers, setDrivers] = useState([])
  const [error, setError] = useState(null)
  const [status, setStatus] = useState(null)   // { status } from a refused fetch

  // The editor: { kind: 'truck'|'trailer', id: unitNo|null } and its form.
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchMe()
      .then((a) => !cancelled && setUser(a))
      .catch(() => !cancelled && setUser(null))
    return () => { cancelled = true }
  }, [])

  const canManage = Boolean(user) && (user.role === 'dispatcher' || user.role === 'admin')

  useEffect(() => {
    if (!user || user.role === 'none') return
    let cancelled = false
    Promise.all([fetchJson('/api/trucks'), fetchJson('/api/trailers')])
      .then(([tk, tr]) => {
        if (cancelled) return
        setTrucks(tk)
        setTrailers(tr)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setStatus(err.status || null)
      })
    // Owner/operator trucks need a driver to name as owner. Dispatch-only,
    // like the roster itself.
    if (user.role === 'dispatcher' || user.role === 'admin') {
      fetchJson('/api/roster').then((r) => !cancelled && setDrivers(r)).catch(() => {})
    }
    return () => { cancelled = true }
  }, [user])

  function openEditor(kind, id) {
    setFormError(null)
    if (kind === 'truck') {
      setForm(id ? truckToForm(trucks.find((t) => t.unitNo === id)) : BLANK_TRUCK)
    } else {
      setForm(id ? trailerToForm(trailers.find((t) => t.trailerNo === id)) : BLANK_TRAILER)
    }
    setEditing({ kind, id })
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
      if (editing.kind === 'truck') {
        const saved = editing.id
          ? await patchJson(`/api/trucks/${encodeURIComponent(editing.id)}`, truckFormToBody(form))
          : await postJson('/api/trucks', { unitNo: form.unitNo.trim(), ...truckFormToBody(form) })
        setTrucks((list) => editing.id ? list.map((t) => (t.unitNo === saved.unitNo ? saved : t)) : [...list, saved])
      } else {
        const saved = editing.id
          ? await patchJson(`/api/trailers/${encodeURIComponent(editing.id)}`, trailerFormToBody(form))
          : await postJson('/api/trailers', { trailerNo: form.trailerNo.trim(), ...trailerFormToBody(form) })
        setTrailers((list) => editing.id ? list.map((t) => (t.trailerNo === saved.trailerNo ? saved : t)) : [...list, saved])
      }
      closeEditor()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (user === undefined) return <div className="page"><p className="muted">Loading...</p></div>
  if (!user) return <AccessNotice status={401} error="Sign in to see the fleet." />
  if (user.role === 'none') return <AccessNotice status={403} error="Your account is waiting for approval." />
  if (status === 401 || status === 403) return <AccessNotice status={status} error={error} />

  const alerts = trucks && trailers ? warnings(trucks, trailers) : []
  const active = (list, key) => (list || []).filter((t) => t.status === 'Active').length

  return (
    <div className="page">
      <nav className="board-nav board-nav-top">
        <Link to="/">← Load board</Link>
      </nav>

      <header>
        <h1>Fleet</h1>
        <p className="sub">
          {trucks && trailers
            ? `${active(trucks)} of ${trucks.length} trucks and ${active(trailers)} of ${trailers.length} trailers in service`
            : 'Loading...'}
        </p>
      </header>

      {error && <div className="error">Could not load data: {error}</div>}

      {alerts.length > 0 && (
        <ul className="fleet-alerts">
          {alerts.map((a) => (
            <li key={a.key} className={a.days < 0 ? 'due-past' : 'due-soon'}>{a.text}</li>
          ))}
        </ul>
      )}

      {editing && (
        <form className="add-form" onSubmit={handleSave}>
          <h2>
            {editing.id
              ? `Edit ${editing.kind} ${editing.id}`
              : editing.kind === 'truck' ? 'New truck' : 'New trailer'}
          </h2>
          {formError && <div className="error">{formError}</div>}
          <fieldset disabled={saving}>
            {editing.kind === 'truck'
              ? <TruckForm form={form} onChange={(n, v) => setForm((f) => ({ ...f, [n]: v }))} isNew={!editing.id} drivers={drivers} />
              : <TrailerForm form={form} onChange={(n, v) => setForm((f) => ({ ...f, [n]: v }))} isNew={!editing.id} />}
            <div className="actions">
              <button type="submit" className="primary">{saving ? 'Saving...' : 'Save'}</button>
              <button type="button" onClick={closeEditor}>Cancel</button>
            </div>
          </fieldset>
        </form>
      )}

      <h2 className="section-title">Trucks</h2>
      {trucks && <TruckTable trucks={trucks} onEdit={canManage ? (id) => openEditor('truck', id) : null} />}
      {canManage && !editing && (
        <p><button type="button" onClick={() => openEditor('truck', null)}>+ Add truck</button></p>
      )}

      <h2 className="section-title">Trailers</h2>
      {trailers && <TrailerTable trailers={trailers} onEdit={canManage ? (id) => openEditor('trailer', id) : null} />}
      {canManage && !editing && (
        <p><button type="button" onClick={() => openEditor('trailer', null)}>+ Add trailer</button></p>
      )}
    </div>
  )
}
