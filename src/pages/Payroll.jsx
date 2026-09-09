import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fetchJson, postJson } from '../lib/api.js'
import { fetchMe } from '../lib/auth.js'
import { formatMoney, formatDate } from '../lib/format.js'
import AccessNotice from '../components/AccessNotice.jsx'
import PayrunPreview from '../components/payroll/PayrunPreview.jsx'

// ---------------------------------------------------------------------------
// The pay run, at /payroll. Admin only.
//
// Two steps, deliberately: preview, then generate. The preview is a GET that
// writes nothing and shows exactly what the POST would create; the POST
// sends the same period back with the drivers that were left ticked. Nothing
// is paid that was not on the screen first.
// ---------------------------------------------------------------------------

// The same default the server uses, computed here so the boxes are filled
// before the first request: the last complete Sunday-to-Saturday week, paid
// the Friday after.
function defaultPeriod() {
  const now = new Date()
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  const dow = today.getUTCDay()
  const end = new Date(today)
  end.setUTCDate(end.getUTCDate() - (dow + 1))
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 6)
  const check = new Date(end)
  check.setUTCDate(check.getUTCDate() + 6)
  const iso = (d) => d.toISOString().slice(0, 10)
  return { periodStart: iso(start), periodEnd: iso(end), checkDate: iso(check) }
}

export default function Payroll() {
  const [user, setUser] = useState(undefined)
  const [period, setPeriod] = useState(defaultPeriod)
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
    setPeriod((p) => ({ ...p, [name]: value }))
    // A changed period invalidates what was previewed under the old one.
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
      const params = new URLSearchParams(period)
      const p = await fetchJson(`/api/payrun?${params}`)
      setPlan(p)
      setSelected(new Set(p.settlements.filter((s) => !s.conflict).map((s) => s.driverCode)))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function toggle(code) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  async function handleGenerate() {
    if (busy || !plan || selected.size === 0) return
    setBusy(true)
    setError(null)
    try {
      const r = await postJson('/api/payrun', { ...period, driverCodes: [...selected] })
      setResult(r)
      setPlan(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (user === undefined) return <div className="page"><p className="muted">Loading...</p></div>
  if (!user) return <AccessNotice status={401} error="Sign in to run payroll." />
  if (user.role !== 'admin') return <AccessNotice status={403} error="Only an administrator can run payroll." />

  const chosenPay = plan
    ? plan.settlements.filter((s) => selected.has(s.driverCode)).reduce((t, s) => t + (s.net ?? s.routePay), 0)
    : 0

  return (
    <div className="page">
      <nav className="board-nav board-nav-top">
        <Link to="/settlements">← Driver settlements</Link>
        <Link to="/payroll/deductions">Standing deductions →</Link>
        <Link to="/">Load board</Link>
      </nav>

      <header>
        <h1>Pay run</h1>
        <p className="sub">Delivered loads that have not been paid become settlements. Preview first; nothing is written until you generate.</p>
      </header>

      <form className="filters" onSubmit={handlePreview}>
        <label>
          Period start
          <input type="date" name="periodStart" value={period.periodStart} onChange={setField} required />
        </label>
        <label>
          Period end
          <input type="date" name="periodEnd" value={period.periodEnd} onChange={setField} required />
        </label>
        <label>
          Check date
          <input type="date" name="checkDate" value={period.checkDate} onChange={setField} required />
        </label>
        <button type="submit" className="primary" disabled={busy}>{busy && !plan ? 'Working...' : 'Preview'}</button>
      </form>

      {error && <div className="error">{error}</div>}

      {plan && (
        <>
          <p className="muted hint">
            Everything delivered on or before {formatDate(plan.periodEnd)} and not yet on a statement.
            Untick a driver to leave them for the next run.
          </p>
          <PayrunPreview plan={plan} selected={selected} onToggle={toggle} />
          {/* No button when there is nothing to press it for. A disabled
              "Generate 0 settlements" reads as something being wrong. */}
          {plan.settlements.length > 0 && (
            <p className="actions">
              <button type="button" className="primary" onClick={handleGenerate} disabled={busy || selected.size === 0}>
                {busy ? 'Generating...' : `Generate ${selected.size} settlement${selected.size === 1 ? '' : 's'} · ${formatMoney(chosenPay)}`}
              </button>
            </p>
          )}
          <p className="muted hint">
            Route pay from the loads, plus the accessorials entered on them, less each driver's standing
            deductions. A charge turned in after its load was settled is paid on the next run.
          </p>
        </>
      )}

      {result && (
        <>
          <h2 className="section-title">Created · check date {formatDate(result.checkDate)}</h2>
          <ul className="payrun-created">
            {result.created.map((c) => (
              <li key={c.driverCode}>
                <Link to={`/settlements/${encodeURIComponent(c.driverCode)}?date=${c.checkDate}`}>{c.documentNo}</Link>
                {' · '}{c.name}{' · '}{c.loadCount} load{c.loadCount === 1 ? '' : 's'}{' · '}{formatMoney(c.routePay)}
                {c.extrasTotal ? <> plus {formatMoney(c.extrasTotal)}</> : null}
                {c.deductionTotal ? <> less {formatMoney(-c.deductionTotal)}</> : null}
                {(c.extrasTotal || c.deductionTotal) ? <> = <strong>{formatMoney(c.net)}</strong></> : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
