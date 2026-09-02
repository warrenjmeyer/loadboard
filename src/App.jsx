import { useState, useEffect, useMemo } from 'react'
import LoadFilters from './components/LoadFilters.jsx'
import LoadTable from './components/LoadTable.jsx'
import AddLoadForm from './components/AddLoadForm.jsx'
import { fetchJson, postJson, fetchUser } from './lib/api.js'

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

  // Who is signed in. Kept here rather than in AddLoadForm because it is one
  // answer for the whole page, and asking twice would mean two requests.
  //
  // Three states, not two: `undefined` until /.auth/me answers, then a
  // principal or null. Starting at null instead would be a claim we cannot
  // support yet, and the visible cost is a "Sign in" prompt flashing at
  // someone who is already signed in.
  const [user, setUser] = useState(undefined)

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

  // A second effect, not another branch of the first one. They are unrelated
  // questions with unrelated failure modes: /.auth/me is served by the
  // platform and answers instantly, while /api/loads goes to a database that
  // may be asleep. Sharing an effect would make the board wait on the login
  // check, or the login check wait on the board.
  useEffect(() => {
    let cancelled = false
    fetchUser().then((principal) => {
      if (!cancelled) setUser(principal)
    })
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

  // The load is saved first and shown second. The alternative -- put it on the
  // board immediately, undo it if the POST fails -- feels faster and is worth
  // knowing about, but it means holding a row that may not be real and
  // deciding what to do when someone reloads mid-flight. Save first is honest:
  // what is on the board is what is in the table.
  //
  // State updates are still IMMUTABLE. Build a new array; never push into the
  // old one. React decides whether to re-render by comparing the old value to
  // the new one by reference -- mutate in place and the reference is
  // unchanged, so React concludes nothing happened and the screen goes stale.
  //
  // Errors are re-thrown rather than shown here, because the form is where the
  // person is looking and where their typing still is. App's job is the board.
  async function handleAddLoad(draft) {
    try {
      // The row that comes back is the one SQL wrote: status filled in, rate
      // rounded to the column's two decimals. Using the draft instead would
      // put a slightly different load on the board than the one that exists.
      const saved = await postJson('/api/loads', draft, {
        onWaking: () => setWaking(true),
      })
      setLoads((current) => [saved, ...current])
    } catch (err) {
      // `mayHaveLanded` means the POST was retried and the retry hit a
      // duplicate -- most likely its own first attempt, which timed out while
      // the database woke but wrote the row anyway. Asking the board settles
      // it: if the load is there, the save worked and saying otherwise would
      // send someone hunting for a problem that does not exist.
      if (err.mayHaveLanded) {
        const rows = await fetchJson('/api/loads').catch(() => null)
        if (rows) {
          setLoads(rows)
          if (rows.some((load) => load.id === draft.id)) return
        }
      }
      throw err
    } finally {
      setWaking(false)
    }
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

      {/* The same "database is asleep" message the first load shows, for the
          save that runs into it. Without this a POST during a wake-up is a
          disabled button and a minute of nothing. */}
      {!loading && waking && (
        <p className="muted">
          Waking the database — this can take up to a minute after a quiet spell.
        </p>
      )}

      <AddLoadForm onAddLoad={handleAddLoad} user={user} />

      {user && (
        <p className="muted signin-note">
          Signed in as {user.userDetails} ·{' '}
          <a href="/.auth/logout?post_logout_redirect_uri=/">Sign out</a>
        </p>
      )}

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
