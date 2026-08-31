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

  // Separate from `loading` because it means something different to the person
  // waiting: not "this is taking a moment" but "the database is asleep and we
  // are waiting on it." Worth saying out loud, because it takes up to a minute.
  const [waking, setWaking] = useState(false)

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

    // Why this retries instead of just fetching once:
    //
    // The database is serverless and pauses itself when nobody uses it. Waking
    // it takes 30-60 seconds, and Azure Static Web Apps cuts a function request
    // off well before that (around 45s), so the FIRST visit after a quiet spell
    // gets a 500 rather than a slow answer. No timeout we set in the function
    // can change that -- the platform gives up first.
    //
    // The saving grace: the request that failed is what started the wake-up. By
    // the time we ask again the database is usually up, so a couple of retries
    // turn an error page into a slow load.
    async function loadLoads() {
      const waitsMs = [3000, 6000, 10000]

      for (let attempt = 0; attempt <= waitsMs.length; attempt++) {
        try {
          const res = await fetch('/api/loads')
          if (!res.ok) throw new Error(`HTTP ${res.status}`)

          // A 200 is not proof you got what you asked for. When /api is not
          // reachable, the dev server answers with index.html -- the SPA
          // fallback -- and that is a perfectly good 200. Calling res.json() on
          // it fails with "Unexpected token '<'", which describes the symptom
          // and hides the cause. Check what came back before trusting it.
          const type = res.headers.get('content-type') || ''
          if (!type.includes('application/json')) {
            // Retrying cannot fix a missing proxy, so do not spend 19 seconds
            // discovering that. Fail immediately and say what to do.
            const fatal = new Error('the API did not respond. Restart the dev server, then reload.')
            fatal.fatal = true
            throw fatal
          }

          const data = await res.json()

          // Guard against setting state after the component is gone. React
          // warns about this, and it is a genuine memory-leak source.
          if (cancelled) return
          setLoads(data)
          setWaking(false)
          setLoading(false)
          return
        } catch (err) {
          if (cancelled) return

          if (err.fatal || attempt === waitsMs.length) {
            setError(err.message)
            setWaking(false)
            setLoading(false)
            return
          }

          setWaking(true)
          await new Promise((resolve) => setTimeout(resolve, waitsMs[attempt]))
        }
      }
    }

    loadLoads()

    // The returned function is the cleanup. React runs it before the effect
    // re-runs and when the component unmounts. The `cancelled` checks above are
    // what make it work across an await: the fetch cannot be taken back, but we
    // can decline to touch state once it finishes.
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
    </div>
  )
}
