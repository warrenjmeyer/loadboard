import { useState, useEffect, useMemo } from 'react'
import LoadFilters from './components/LoadFilters.jsx'
import LoadTable from './components/LoadTable.jsx'
import AddLoadForm from './components/AddLoadForm.jsx'

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

  const [search, setSearch] = useState('')
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

    fetch('/api/loads')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data) => {
        // Guard against setting state after the component is gone. React warns
        // about this, and in a real app it is a genuine memory-leak source.
        if (!cancelled) {
          setLoads(data)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message)
          setLoading(false)
        }
      })

    // The returned function is the cleanup. React runs it before the effect
    // re-runs and when the component unmounts.
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
          {loading ? 'Loading...' : `${visibleLoads.length} of ${loads.length} loads`}
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

      {loading ? <p className="muted">Fetching loads...</p> : <LoadTable loads={visibleLoads} />}

      <AddLoadForm onAddLoad={handleAddLoad} />
    </div>
  )
}
