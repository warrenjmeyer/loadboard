import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { fetchJson, postJson, patchJson } from '../lib/api.js'
import { fetchMe } from '../lib/auth.js'
import AccessNotice from '../components/AccessNotice.jsx'
import DeductionTable from '../components/payroll/DeductionTable.jsx'
import DeductionForm, { BLANK_DEDUCTION, deductionToForm, deductionFormToBody } from '../components/payroll/DeductionForm.jsx'

// ---------------------------------------------------------------------------
// Standing deductions, at /payroll/deductions?driver=CODE. Admin only.
//
// The driver is a search param, not a path segment, because it is a view
// setting: the page is "deductions", and which driver's is what you are
// looking at -- the same reasoning as ?date= on a statement.
// ---------------------------------------------------------------------------
export default function Deductions() {
  const [searchParams, setSearchParams] = useSearchParams()
  const driver = (searchParams.get('driver') || '').toUpperCase()

  const [user, setUser] = useState(undefined)
  const [roster, setRoster] = useState(null)
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)

  const [editing, setEditing] = useState(null)   // null | { id: number|null }
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchMe().then((a) => !cancelled && setUser(a)).catch(() => !cancelled && setUser(null))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!user || user.role !== 'admin') return
    let cancelled = false
    fetchJson('/api/roster').then((r) => !cancelled && setRoster(r)).catch((err) => !cancelled && setError(err.message))
    return () => { cancelled = true }
  }, [user])

  useEffect(() => {
    if (!user || user.role !== 'admin' || !driver) { setRows(null); return }
    let cancelled = false
    setRows(null)
    setEditing(null)
    fetchJson(`/api/deductions?driver=${encodeURIComponent(driver)}`)
      .then((r) => !cancelled && setRows(r))
      .catch((err) => !cancelled && setError(err.message))
    return () => { cancelled = true }
  }, [user, driver])

  function pickDriver(code) {
    setSearchParams(code ? { driver: code } : {}, { replace: true })
  }

  function openEditor(id) {
    setFormError(null)
    setForm(id ? deductionToForm(rows.find((d) => d.deductionId === id)) : BLANK_DEDUCTION)
    setEditing({ id })
  }

  async function handleSave(e) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    setFormError(null)
    try {
      const body = deductionFormToBody(form)
      let saved
      if (editing.id) {
        delete body.code
        saved = await patchJson(`/api/deductions/${editing.id}`, body)
        setRows((list) => list.map((d) => (d.deductionId === saved.deductionId ? saved : d)))
      } else {
        saved = await postJson('/api/deductions', { driverCode: driver, ...body })
        setRows((list) => [...list, saved])
      }
      setEditing(null)
      setForm(null)
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (user === undefined) return <div className="page"><p className="muted">Loading...</p></div>
  if (!user) return <AccessNotice status={401} error="Sign in to manage deductions." />
  if (user.role !== 'admin') return <AccessNotice status={403} error="Only an administrator can manage deductions." />

  const picked = roster?.find((d) => d.driverCode === driver)

  return (
    <div className="page">
      <nav className="board-nav board-nav-top">
        <Link to="/payroll">← Pay run</Link>
        <Link to="/settlements">Driver settlements</Link>
      </nav>

      <header>
        <h1>Standing deductions</h1>
        <p className="sub">What comes out of a driver's settlement every week. The pay run applies these after route pay.</p>
      </header>

      {error && <div className="error">{error}</div>}

      <div className="filters">
        <label>
          Driver
          <select value={driver} onChange={(e) => pickDriver(e.target.value)} disabled={!roster}>
            <option value="">{roster ? '— choose —' : 'Loading...'}</option>
            {(roster || []).map((d) => (
              <option key={d.driverCode} value={d.driverCode}>
                {d.name} ({d.driverCode}){d.driverType === 'OWNER' ? ' · O/O' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {driver && rows && (
        <>
          <h2 className="section-title">{picked ? picked.name : driver}</h2>
          <DeductionTable deductions={rows} onEdit={openEditor} />
          {!editing && <p><button type="button" onClick={() => openEditor(null)}>+ Add deduction</button></p>}
        </>
      )}

      {editing && (
        <form className="add-form" onSubmit={handleSave}>
          <h2>{editing.id ? `Edit ${form.code}` : `New deduction for ${driver}`}</h2>
          {formError && <div className="error">{formError}</div>}
          <fieldset disabled={saving}>
            <DeductionForm form={form} onChange={(n, v) => setForm((f) => ({ ...f, [n]: v }))} isNew={!editing.id} />
            <div className="actions">
              <button type="submit" className="primary">{saving ? 'Saving...' : 'Save'}</button>
              <button type="button" onClick={() => { setEditing(null); setForm(null) }}>Cancel</button>
            </div>
          </fieldset>
        </form>
      )}
    </div>
  )
}
