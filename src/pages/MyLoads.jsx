import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fetchJson } from '../lib/api.js'
import { fetchMe } from '../lib/auth.js'
import { formatWindow, formatMoney, formatMiles, statusSlug } from '../lib/format.js'
import LoadTable from '../components/LoadTable.jsx'
import AccessNotice from '../components/AccessNotice.jsx'

// ---------------------------------------------------------------------------
// A driver's loads, at /my-loads.
//
// The board answers "what freight exists". A driver in a cab has a narrower
// question: what am I on, where does it go, when does it have to be there,
// and who do I call at the gate. This page answers that and nothing else,
// with the current load first and large, and history underneath.
//
// It is filtered in the browser from the same GET /api/loads the board uses,
// which is not a leak: a driver already sees every load with every driver on
// it, because the role is trusted with the history. If that ever changes, the
// filter moves to the server and this page does not.
// ---------------------------------------------------------------------------

const CURRENT = new Set(['Covered', 'In Transit'])

function Current({ load }) {
  return (
    <Link to={`/loads/${encodeURIComponent(load.id)}`} className="my-load">
      <div className="my-load-head">
        <span className="mono">{load.id}</span>
        <span className={`badge badge-${statusSlug(load.status)}`}>{load.status}</span>
      </div>
      <div className="my-load-lane">{load.origin} → {load.destination}</div>
      <dl className="my-load-facts">
        <div><dt>Pickup</dt><dd>{formatWindow(load.pickupStart, load.pickupEnd) || '—'}</dd></div>
        <div><dt>Deliver</dt><dd>{formatWindow(load.deliveryStart, load.deliveryEnd) || '—'}</dd></div>
        <div><dt>Miles</dt><dd>{formatMiles(load.miles)}</dd></div>
        <div><dt>Equipment</dt><dd>{load.equipment}{load.tempF != null ? ` · ${load.tempF}°F` : ''}</dd></div>
        {load.shipperName && <div><dt>Shipper</dt><dd>{load.shipperName}</dd></div>}
        {load.consigneeName && <div><dt>Consignee</dt><dd>{load.consigneeName}</dd></div>}
      </dl>
      <p className="my-load-cta">
        {load.status === 'Covered' ? 'Open to mark picked up →' : 'Open to mark delivered →'}
      </p>
    </Link>
  )
}

export default function MyLoads() {
  const [user, setUser] = useState(undefined)
  const [loads, setLoads] = useState(null)
  const [error, setError] = useState(null)
  const [waking, setWaking] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchMe()
      .then((account) => !cancelled && setUser(account))
      .catch(() => !cancelled && setUser(null))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!user || user.role !== 'driver') return
    let cancelled = false
    fetchJson('/api/loads', { onWaking: () => !cancelled && setWaking(true) })
      .then((rows) => {
        if (cancelled) return
        setLoads(rows.filter((l) => l.driverCode && l.driverCode.toUpperCase() === user.driverCode.toUpperCase()))
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setWaking(false))
    return () => { cancelled = true }
  }, [user])

  if (user === undefined) return <div className="page"><p className="muted">Loading...</p></div>
  if (!user) return <AccessNotice status={401} error="Sign in to see your loads." />
  if (user.role !== 'driver') {
    return <AccessNotice status={403} error="This page lists the loads assigned to a driver account. Dispatchers see every load on the board." />
  }

  const current = (loads || []).filter((l) => CURRENT.has(l.status))
  const past = (loads || []).filter((l) => !CURRENT.has(l.status))
  const paid = past.reduce((sum, l) => sum + (l.status === 'Delivered' ? l.miles : 0), 0)

  return (
    <div className="page">
      <nav className="board-nav board-nav-top">
        <Link to="/">← Load board</Link>
        <Link to={`/settlements/${encodeURIComponent(user.driverCode)}`}>My settlements →</Link>
      </nav>

      <header>
        <h1>My loads</h1>
        <p className="sub">
          {user.displayName || user.email} · <span className="mono">{user.driverCode}</span>
          {loads && ` · ${current.length} current · ${past.length} delivered · ${formatMiles(paid)} miles hauled`}
        </p>
      </header>

      {error && <div className="error">Could not load data: {error}</div>}

      {!loads && !error && (
        <p className="muted">
          {waking
            ? 'The database pauses when it is idle. Waking it takes up to a minute.'
            : 'Fetching your loads...'}
        </p>
      )}

      {loads && current.length === 0 && (
        <p className="muted">Nothing assigned to you right now. Dispatch will put the next load here.</p>
      )}

      {current.map((l) => <Current key={l.id} load={l} />)}

      {loads && past.length > 0 && (
        <>
          <h2 className="section-title">Delivered</h2>
          <LoadTable loads={[...past].sort((a, b) => (b.deliveredDate || '').localeCompare(a.deliveredDate || ''))} />
          <p className="muted hint">
            {formatMoney(past.reduce((s, l) => s + l.rate, 0))} of freight billed on these loads. What
            you were paid for them is on your settlement.
          </p>
        </>
      )}
    </div>
  )
}
