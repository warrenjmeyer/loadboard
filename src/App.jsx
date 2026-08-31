import { useState, useEffect, useMemo } from 'react'
import LoadFilters from './components/LoadFilters.jsx'
import LoadTable from './components/LoadTable.jsx'
import AddLoadForm from './components/AddLoadForm.jsx'
import { fetchJson } from './lib/api.js'

// ---------------------------------------------------------------------------
// App is the "container" component. It owns the data and the filter settings,
// and hands pieces of both down to smaller components as props.
//
// The rule this follows is "lift state up": when two components need the same
// piece of data, that data lives in their closest common parent. LoadFilters
// changes the filter, LoadTable reads it -- so the filter lives here, in App.
// ---------------------------------------------------------------------------
export default function App() {
  // useState gives you a value plus a setter. Calling the setter is what tells
  // React "this changed, re-run this component and update the screen."
  // Assigning to a plain variable would NOT do that -- React would never know.
  const [loads, setLoads] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Separate from `loading` because it means something different to the person
  // waiting: not "this is taking a moment" but "the database is asleep and we
  // are waiting on it." Worth saying out loud, because it takes up to a minute.
  const [waking, setWaking] = useState(false)

  const [search, setSearch] = useState('')
  const [equipment, setEquipment] = useState('All')
  const [availableOnly, setAvailableOnly] = useState(false)

  // Drivers with settlements, for the links at the bottom. Deliberately has no
  // error state: the board is about loads, and failing to draw a nav is not
  // worth interrupting that with a red banner. If the call fails the list stays
  // empty and the section does not render.
  const [drivers, setDrivers] = useState([])

  // useEffect is for things that reach OUTSIDE React: network calls, timers,
  // subscriptions. The [] dependency array means "run this once, after the
  // first render." Change [] to [something] and it re-runs whenever that
  // something changes.
  //
  // Why not just fetch at the top of the function body? Because the component
  // function runs on every single render. You would fetch in an infinite loop.
  useEffect(() => {
    let cancelled = false

    // fetchJson handles the retrying (see src/lib/api.js): the database pauses
    // when idle and the first request after a quiet spell fails while it wakes.
    // The settlement page needs exactly the same behaviour, which is why this
    // lives in one place rather than in both components.
    fetchJson('/api/loads', {
      onWaking: () => !cancelled && setWaking(true),
    })
      .then((data) => {
        // Guard against setting state after the component is gone. React warns
        // about this, and it is a genuine memory-leak source.
        if (cancelled) return
        setLoads(data)
        setWaking(false)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setWaking(false)
        setLoading(false)
      })

    // Second, independent request. Kept in the same effect because it shares
    // the same `cancelled` flag and the same lifetime; kept as a separate
    // fetch because the two do not depend on each other, so they should not
    // wait for each other either.
    fetchJson('/api/drivers')
      .then((rows) => {
        if (!cancelled) setDrivers(rows)
      })
      .catch(() => {
        // Swallowed on purpose. See the comment on the `drivers` state.
      })

    // The returned function is the cleanup. React runs it before the effect
    // re-runs and when the component unmounts. The `cancelled` checks are what
    // make it work across an await: the fetch cannot be taken back, but we can
    // decline to touch state once it finishes.
    return () => {
      cancelled = true
    }
  }, [])

  // DERIVED state. The filtered list is not stored in useState -- it is
  // computed from loads + the filters every render. This is the single most
  // common React mistake to avoid: do not keep a `filteredLoads` state
  // variable in sync by hand. Anything you can calculate, calculate.
  //
  // useMemo only caches the result so the math is skipped when nothing
  // relevant changed. On a list this small you could drop useMemo entirely
  // and nothing would break.
  const visibleLoads = useMemo(() => {
    const term = search.trim().toLowerCase()

    return loads.filter((load) => {
      if (equipment !== 'All' && load.equipment !== equipment) return false
      if (availableOnly && load.status !== 'Available') return false
      if (term) {
        const haystack = `${load.id} ${load.origin} ${load.destination}`.toLowerCase()
        if (!haystack.includes(term)) return false
      }
      return true
    })
  }, [loads, search, equipment, availableOnly])

  // State updates must be IMMUTABLE. Build a new array; never push into the
  // old one. React decides whether to re-render by comparing the old value to
  // the new one by reference -- mutate in place and the reference is
  // unchanged, so React concludes nothing happened and the screen goes stale.
  function handleAddLoad(newLoad) {
    setLoads((current) => [newLoad, ...current])
  }

  const totalRevenue = visibleLoads.reduce((sum, load) => sum + load.rate, 0)

  return (
    <div className="page">
      <header>
        <h1>Load Board</h1>
        <p className="sub">
          {loading
            ? waking
              ? 'Waking the database...'
              : 'Loading...'
            : `${visibleLoads.length} of ${loads.length} loads`}
          {!loading && totalRevenue > 0 && ` · $${totalRevenue.toLocaleString()} shown`}
        </p>
      </header>

      {/* Conditional rendering: there is no <cfif>. You use plain JavaScript.
          `&&` renders the right side only when the left is truthy. */}
      {error && <div className="error">Could not load data: {error}</div>}

      <LoadFilters
        search={search}
        equipment={equipment}
        availableOnly={availableOnly}
        onSearchChange={setSearch}
        onEquipmentChange={setEquipment}
        onAvailableOnlyChange={setAvailableOnly}
      />

      {loading ? (
        <p className="muted">
          {waking
            ? 'The database pauses when it is idle. Waking it takes up to a minute — this only happens on the first visit after a quiet spell.'
            : 'Fetching loads...'}
        </p>
      ) : (
        <LoadTable loads={visibleLoads} />
      )}

      <AddLoadForm onAddLoad={handleAddLoad} />

      {/* Plain anchors, not buttons: these change the page, and a link is what
          the browser already knows how to open in a new tab.

          The list comes from the API rather than being hardcoded -- there are
          twelve drivers now, and a hand-maintained list is one that goes stale
          the first time someone is hired. */}
      {drivers.length > 0 && (
        <nav className="board-nav">
          <div className="board-nav-title">Driver settlements</div>
          {drivers.map((d) => (
            <a key={d.driverCode} href={`?id=${d.driverCode}`}>
              {d.firstName} {d.lastName}
            </a>
          ))}
        </nav>
      )}
    </div>
  )
}
