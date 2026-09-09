import { useState, useEffect } from 'react'
import { fetchJson } from '../lib/api.js'
import LoadForm, { loadToForm, formToBody, changedKeys } from './LoadForm.jsx'

// ---------------------------------------------------------------------------
// What can be DONE to a load, rendered from what the server said may be done.
//
// `actions` arrives with the load from GET /api/loads/{id}: canEdit, canAssign
// and the list of statuses this person may move it to. This component draws
// buttons for exactly those and nothing else. It has no idea what a
// dispatcher is; it knows that canAssign is true and shows a driver picker.
// The rule lives once, on the server, where it is enforced.
//
// A driver on their own load gets two buttons over the life of the load --
// "Picked up", then "Delivered" -- and this is the same component that gives
// a dispatcher the whole panel. One component, shaped by its props.
//
// onChange(body) sends a PATCH and resolves with the saved load. Errors come
// back as a message to show; the load on screen is only replaced with what
// the server actually wrote.
// ---------------------------------------------------------------------------

// Local date, not toISOString(): a delivery marked at 22:30 in Iowa is
// delivered today, and UTC has already moved on to tomorrow.
function todayLocal() {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

// What each move is called on a button. The status name is the state; the
// button is the act that gets there, and those read differently -- nobody
// presses "In Transit", they press "Picked up".
function labelFor(to, from) {
  switch (to) {
    case 'In Transit': return from === 'Delivered' ? 'Undo delivery' : 'Picked up'
    case 'Delivered': return 'Delivered'
    case 'Cancelled': return 'Cancel load'
    case 'Available': return from === 'Cancelled' ? 'Reinstate' : 'Remove driver'
    case 'Covered': return from === 'In Transit' ? 'Undo pickup' : 'Mark covered'
    default: return to
  }
}

// The word beside a truck or trailer in the picker: where it is, or why it
// cannot go. The picker still lists a truck that is in the shop, because
// "which truck" and "why not that one" are the same question.
function availability(item, thisLoadId) {
  if (item.status !== 'Active') return item.status.toLowerCase()
  if (item.currentLoad && item.currentLoad.id !== thisLoadId) return `on ${item.currentLoad.id}`
  return 'free'
}

export default function DispatchPanel({ load, actions, onChange }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Assignment. The three lists are fetched together because a dispatcher
  // who can assign needs all three, and they change on the same events.
  const [roster, setRoster] = useState(null)
  const [trucks, setTrucks] = useState(null)
  const [trailers, setTrailers] = useState(null)
  const [customers, setCustomers] = useState(null)
  const [driverCode, setDriverCode] = useState(load.driverCode || '')
  const [unitNo, setUnitNo] = useState(load.unitNo || '')
  const [trailerNo, setTrailerNo] = useState(load.trailerNo || '')

  // Delivery date, shown only when "Delivered" is on offer.
  const [deliveredDate, setDeliveredDate] = useState(todayLocal())

  // Editing
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(() => loadToForm(load))

  // Keep the local inputs in step when the load changes under us -- after a
  // save, or when the page moves to a different load.
  useEffect(() => {
    setDriverCode(load.driverCode || '')
    setUnitNo(load.unitNo || '')
    setTrailerNo(load.trailerNo || '')
    setForm(loadToForm(load))
  }, [load])

  // Only fetched for somebody who can assign. They are lists of every driver
  // and truck and what each is on, and there is no reason to hand them to
  // anyone who cannot act on them.
  useEffect(() => {
    if (!actions.canAssign) return
    let cancelled = false
    Promise.all([fetchJson('/api/roster'), fetchJson('/api/trucks'), fetchJson('/api/trailers'), fetchJson('/api/customers')])
      .then(([r, tk, tr, cu]) => {
        if (cancelled) return
        setRoster(r)
        setTrucks(tk)
        setTrailers(tr)
        setCustomers(cu)
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => { cancelled = true }
  }, [actions.canAssign])

  async function send(body) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onChange(body)
      setEditing(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function pickDriver(code) {
    setDriverCode(code)
    // The driver's own truck is the default, and usually the answer. A
    // driver with no unit on file leaves the box as it was.
    const d = roster?.find((r) => r.driverCode === code)
    if (d?.unitNo) setUnitNo(d.unitNo)
    if (!code) setUnitNo('')
  }

  function handleAssign(e) {
    e.preventDefault()
    send({ driverCode: driverCode || null, unitNo: unitNo || null, trailerNo: trailerNo || null })
  }

  function handleStatus(to) {
    const body = { status: to }
    if (to === 'Delivered') body.deliveredDate = deliveredDate
    send(body)
  }

  function handleEdit(e) {
    e.preventDefault()
    const keys = changedKeys(load, form)
    if (keys.length === 0) {
      setEditing(false)
      return
    }
    send(formToBody(form, keys))
  }

  const nothingToOffer = !actions.canEdit && !actions.canAssign && actions.transitions.length === 0
  if (nothingToOffer) return null

  const ready = roster && trucks && trailers

  // Trailers of the load's own equipment type first, then the rest. A reefer
  // load can go on a dry van by mistake, and the order is the nudge.
  const trailerOptions = trailers
    ? [...trailers].sort((a, b) =>
        (a.trailerType === load.equipment ? 0 : 1) - (b.trailerType === load.equipment ? 0 : 1)
        || a.trailerNo.localeCompare(b.trailerNo, undefined, { numeric: true }))
    : []

  return (
    <section className="dispatch">
      {error && <div className="error">{error}</div>}

      {actions.canAssign && (
        <form className="dispatch-row" onSubmit={handleAssign}>
          <label>
            Driver
            <select value={driverCode} onChange={(e) => pickDriver(e.target.value)} disabled={busy || !ready}>
              <option value="">{ready ? '— nobody —' : 'Loading...'}</option>
              {(roster || []).map((d) => (
                // What each option says is the dispatcher's whole decision:
                // who they are, whether they are already on something, and
                // whether their truck can move.
                <option key={d.driverCode} value={d.driverCode}>
                  {d.name} ({d.driverCode})
                  {d.driverType === 'OWNER' ? ' · O/O' : ''}
                  {d.currentLoad
                    ? ` · on ${d.currentLoad.id} to ${d.currentLoad.destination}`
                    : ' · free'}
                  {d.truckStatus && d.truckStatus !== 'Active' ? ` · truck in ${d.truckStatus.toLowerCase()}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            Truck
            <select value={unitNo} onChange={(e) => setUnitNo(e.target.value)} disabled={busy || !ready}>
              <option value="">— none —</option>
              {(trucks || []).filter((t) => t.status !== 'Retired' || t.unitNo === unitNo).map((t) => (
                <option key={t.unitNo} value={t.unitNo}>
                  {t.unitNo} · {t.description} · {availability(t, load.id)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Trailer
            <select value={trailerNo} onChange={(e) => setTrailerNo(e.target.value)} disabled={busy || !ready}>
              <option value="">— none —</option>
              {trailerOptions.filter((t) => t.status !== 'Retired' || t.trailerNo === trailerNo).map((t) => (
                <option key={t.trailerNo} value={t.trailerNo}>
                  {t.trailerNo} · {t.trailerType} · {availability(t, load.id)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="primary" disabled={busy || !ready}>
            {busy ? 'Saving...' : load.driverCode ? 'Reassign' : 'Assign'}
          </button>
        </form>
      )}

      {actions.transitions.length > 0 && (
        <div className="dispatch-row status-actions">
          {actions.transitions.map((to) => (
            <span key={to} className="status-action">
              {to === 'Delivered' && (
                <input
                  type="date"
                  value={deliveredDate}
                  onChange={(e) => setDeliveredDate(e.target.value)}
                  disabled={busy}
                  aria-label="Delivered on"
                />
              )}
              <button
                type="button"
                className={to === 'Cancelled' ? 'danger' : to === 'Delivered' || to === 'In Transit' ? 'primary' : undefined}
                disabled={busy}
                onClick={() => handleStatus(to)}
              >
                {labelFor(to, load.status)}
              </button>
            </span>
          ))}
        </div>
      )}

      {actions.canEdit && !editing && (
        <div className="dispatch-row">
          <button type="button" onClick={() => { setForm(loadToForm(load)); setEditing(true) }} disabled={busy}>
            Edit details
          </button>
        </div>
      )}

      {actions.canEdit && editing && (
        <form className="add-form" onSubmit={handleEdit}>
          <h2>Edit {load.id}</h2>
          <fieldset disabled={busy}>
            <LoadForm form={form} onChange={(name, value) => setForm((f) => ({ ...f, [name]: value }))} customers={customers} />
            <div className="actions">
              <button type="submit" className="primary">{busy ? 'Saving...' : 'Save changes'}</button>
              <button type="button" onClick={() => { setEditing(false); setError(null) }}>Cancel</button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  )
}
