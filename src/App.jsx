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
export default function App({ initialSearch = '' }) {
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

  // Seeded from ?search= so a link from a pay statement lands on the board
  // already filtered to that load. It is still ordinary state afterwards --
  // typing in the box does not touch the URL.
  const [search, setSearch] = useState(initialSearch)
  const [equipment, setEquipment] = useState('All')
  const [availableOnly, setAvailableOnly] = useState(false)

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

      {/* A plain anchor, not a button: this changes the page, and a link is
          what the browser already knows how to open in a new tab.

          This used to list every driver. That was fine at two and unreadable
          at twenty, which is what the settlements board is for -- it filters,
          which a wall of names cannot. */}
      <nav className="board-nav">
        <a href="?view=settlements">Driver settlements →</a>
      </nav>
    </div>
  )
}
