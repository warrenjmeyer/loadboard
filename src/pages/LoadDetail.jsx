import { useState, useEffect, useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchJson, patchJson } from '../lib/api.js'
import { fetchMe } from '../lib/auth.js'
import { geotabRouteUrl } from '../lib/geotab.js'
import LoadCard from '../components/LoadCard.jsx'
import DispatchPanel from '../components/DispatchPanel.jsx'
import LoadHistory from '../components/LoadHistory.jsx'
import LoadCharges from '../components/LoadCharges.jsx'
import TruckNow from '../components/TruckNow.jsx'
import { postJson, deleteJson } from '../lib/api.js'
import { useTelematics } from '../lib/useTelematics.js'

// ---------------------------------------------------------------------------
// One load, at /loads/L-10412.
//
// The path identifies the resource -- :id, read with useParams -- which is the
// same split Settlement.jsx demonstrates for :driverCode. Nothing about this
// load is a view setting, so this page has no query string at all.
//
// This page used to fetch the whole board and find its row. It now asks
// GET /api/loads/{id}, which exists because the page is no longer read-only:
// the answer carries an `actions` block saying what this person may do to
// this load, and that is a per-load, per-person question the list could not
// answer without sending every load's actions to everyone.
//
// The public/private rule is the same as before and enforced in the same
// place -- the server. A delivered load is NOT FOUND to a signed-out visitor,
// not "forbidden", which would confirm the load exists.
// ---------------------------------------------------------------------------
export default function LoadDetail() {
  const { id } = useParams()

  const [load, setLoad] = useState(null)
  const [events, setEvents] = useState(null)
  const [loading, setLoading] = useState(true)
  const [waking, setWaking] = useState(false)
  const [error, setError] = useState(null)
  const [missing, setMissing] = useState(false)

  // Who is reading. Decides whether the MyGeotab link and the history are
  // worth asking for. Its own effect, and [] not [id]: the answer does not
  // change when you click from one load to the next.
  const [user, setUser] = useState(undefined)

  useEffect(() => {
    let cancelled = false
    fetchMe()
      .then((account) => !cancelled && setUser(account))
      .catch(() => !cancelled && setUser(null))
    return () => { cancelled = true }
  }, [])

  // History names names, so the server only serves it to a real role, and
  // there is no point asking for it on anyone else's behalf.
  const seesHistory = Boolean(user) && user.role !== 'none'

  const [charges, setCharges] = useState(null)

  const loadEvents = useCallback(() => {
    if (!seesHistory) return
    fetchJson(`/api/loads/${encodeURIComponent(id)}/events`)
      .then(setEvents)
      .catch(() => setEvents(null))
    fetchJson(`/api/loads/${encodeURIComponent(id)}/charges`)
      .then(setCharges)
      .catch(() => setCharges(null))
  }, [id, seesHistory])

  // Who may add a charge here. Dispatch: anything. The driver on this load:
  // a reimbursement, because they are the one holding the receipt. Mirrors
  // chargeRules.canAdd on the server, which decides for real.
  const staff = Boolean(user) && (user.role === 'dispatcher' || user.role === 'admin')
  const onThisLoad = Boolean(user) && user.role === 'driver' && load?.driverCode
    && user.driverCode && user.driverCode.toUpperCase() === load.driverCode.toUpperCase()
  const canAddCharge = load && load.status !== 'Cancelled' ? (staff ? 'all' : onThisLoad ? 'reimbursement' : null) : null

  // The truck, live from GeoTab, while the load is moving. Where it is goes
  // to anyone with a role; the driver's hours are a record about a person,
  // so only dispatch and the driver themselves ask for them. The server
  // enforces both; these only decide whether to ask.
  const moving = Boolean(load) && (load.status === 'Covered' || load.status === 'In Transit')
  const askPosition = seesHistory && moving && Boolean(load.unitNo)
  const askHours = moving && Boolean(load.driverCode) && (staff || onThisLoad)
  const position = useTelematics(
    askPosition ? `/api/telematics/positions?unit=${encodeURIComponent(load.unitNo)}` : null,
    { enabled: askPosition }
  )
  const hours = useTelematics(
    askHours ? `/api/telematics/hours?driver=${encodeURIComponent(load.driverCode)}` : null,
    { enabled: askHours }
  )

  async function handleAddCharge(body) {
    const saved = await postJson(`/api/loads/${encodeURIComponent(id)}/charges`, body)
    setCharges((list) => [...(list || []), saved])
    loadEvents()
  }

  async function handleRemoveCharge(chargeId) {
    await deleteJson(`/api/charges/${chargeId}`)
    setCharges((list) => (list || []).filter((c) => c.chargeId !== chargeId))
    loadEvents()
  }

  // [id] and not [] as the dependency array. Clicking from one load straight
  // to another re-uses this component rather than remounting it, so an effect
  // that only ran once would leave the first load on screen at the second
  // load's URL.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setMissing(false)
    setError(null)

    fetchJson(`/api/loads/${encodeURIComponent(id)}`, {
      onWaking: () => !cancelled && setWaking(true),
    })
      .then((data) => {
        if (cancelled) return
        setLoad(data)
      })
      .catch((err) => {
        if (cancelled) return
        if (err.status === 404) setMissing(true)
        else setError(err.message)
      })
      .finally(() => {
        if (cancelled) return
        setWaking(false)
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [id])

  useEffect(() => { loadEvents() }, [loadEvents])

  // The PATCH. The panel calls this with what it wants changed; what comes
  // back is the load as the server wrote it, actions included, and that is
  // what replaces the one on screen. Nothing is shown that was not saved.
  async function handleChange(body) {
    const saved = await patchJson(`/api/loads/${encodeURIComponent(id)}`, body, {
      onWaking: () => setWaking(true),
    })
    setWaking(false)
    setLoad(saved)
    loadEvents()
    return saved
  }

  if (loading) {
    return (
      <div className="page">
        <p className="muted">
          {waking
            ? 'The database pauses when it is idle. Waking it takes up to a minute — this only happens on the first visit after a quiet spell.'
            : 'Fetching load...'}
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page">
        <h1>Could not load {id}</h1>
        <p className="error">{error}</p>
        <nav className="board-nav">
          <Link to="/">← Load board</Link>
        </nav>
      </div>
    )
  }

  // Not found and not permitted are the same screen on purpose, and the wording
  // has to cover both without claiming either. A delivered load is invisible to
  // a signed-out visitor, so "no such load" would be a lie and "sign in to see
  // it" would confirm the load exists. Saying what IS true -- it is not on the
  // board you can see, and signing in may show you more -- gives away nothing.
  if (missing || !load) {
    return (
      <div className="page">
        <h1>{id}</h1>
        <p className="muted">
          That load is not on the board. Delivered freight is only visible once you are
          signed in, so a load number that works for a dispatcher may not work here.
        </p>
        <nav className="board-nav">
          <Link to="/">← Load board</Link> · <Link to="/signin">Sign in</Link>
        </nav>
      </div>
    )
  }

  // A signed-in account with a real role. 'none' is an approved-but-not-yet
  // -granted account, which is not somebody with a MyGeotab login either.
  const showGeotab = seesHistory
  const { actions, ...fields } = load

  return (
    <div className="page">
      <LoadCard load={fields} geotabUrl={showGeotab ? geotabRouteUrl(load) : null} />

      {waking && (
        <p className="muted">Waking the database — this can take up to a minute after a quiet spell.</p>
      )}

      {actions && <DispatchPanel load={fields} actions={actions} onChange={handleChange} />}

      {(askPosition || askHours) && (
        <>
          <h2 className="section-title">Truck now</h2>
          <TruckNow
            position={position.data ? position.data.trucks[0] : null}
            hours={hours.data ? hours.data.drivers[0] : null}
            database={position.data ? position.data.database : null}
            notConnected={position.notConnected || (!askPosition && hours.notConnected)}
            error={position.error || hours.error}
          />
        </>
      )}

      {seesHistory && (
        <>
          <h2 className="section-title">Accessorials</h2>
          <LoadCharges
            charges={charges || []}
            canAdd={canAddCharge}
            canRemove={staff}
            onAdd={handleAddCharge}
            onRemove={handleRemoveCharge}
          />

          <h2 className="section-title">History</h2>
          <LoadHistory events={events} />
        </>
      )}
    </div>
  )
}
