import { useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchJson } from '../lib/api.js'
import { fetchMe } from '../lib/auth.js'
import { geotabRouteUrl } from '../lib/geotab.js'
import LoadCard from '../components/LoadCard.jsx'

// ---------------------------------------------------------------------------
// One load, at /loads/L-10412.
//
// The path identifies the resource -- :id, read with useParams -- which is the
// same split Settlement.jsx demonstrates for :driverCode. Nothing about this
// load is a view setting, so this page has no query string at all.
//
// WHERE THE DATA COMES FROM, and why it looks wasteful.
//
// There is no GET /api/loads/{id}. This page fetches the whole list and finds
// its row in it. One extra route would be tidier, and it is the obvious next
// step -- but the list fetch buys something a single-row route would have to
// re-earn by hand:
//
//   The public/private rule enforces itself. GET /api/loads returns only the
//   32 current loads to anyone anonymous or role-less, because every Delivered
//   row names a driver and a date. So a delivered load's URL is simply NOT
//   FOUND for a signed-out visitor -- not "forbidden", which would confirm the
//   load exists, and not a leak. That is the correct answer, reached without a
//   single line of authorization code in the front end.
//
// A /api/loads/{id} route would need that branch written deliberately, and
// getting it wrong is a quiet disclosure rather than a visible bug. Worth
// doing, worth doing carefully, and not needed to make the page work.
// ---------------------------------------------------------------------------
export default function LoadDetail() {
  const { id } = useParams()

  const [load, setLoad] = useState(null)
  const [loading, setLoading] = useState(true)
  const [waking, setWaking] = useState(false)
  const [error, setError] = useState(null)

  // Who is reading. Only used to decide whether the MyGeotab link is worth
  // showing -- it is useless to somebody with no MyGeotab account, and the
  // board is public. Its own effect, and [] not [id]: the answer does not
  // change when you click from one load to the next.
  const [user, setUser] = useState(undefined)

  // [id] and not [] as the dependency array. Clicking from one load straight
  // to another re-uses this component rather than remounting it, so an effect
  // that only ran once would leave the first load on screen at the second
  // load's URL.
  useEffect(() => {
    let cancelled = false
    setLoading(true)

    fetchJson('/api/loads', {
      onWaking: () => !cancelled && setWaking(true),
    })
      .then((data) => {
        if (cancelled) return
        setLoad(data.find((l) => l.id === id) ?? null)
        setWaking(false)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setWaking(false)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    let cancelled = false
    fetchMe()
      .then((account) => !cancelled && setUser(account))
      .catch(() => !cancelled && setUser(null))
    return () => {
      cancelled = true
    }
  }, [])

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
  if (!load) {
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
  const showGeotab = Boolean(user) && user.role !== 'none'

  return (
    <div className="page">
      <LoadCard load={load} geotabUrl={showGeotab ? geotabRouteUrl(load) : null} />
    </div>
  )
}
