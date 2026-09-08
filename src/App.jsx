import { useState, useEffect, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import LoadFilters from './components/LoadFilters.jsx'
import LoadTable from './components/LoadTable.jsx'
import AddLoadForm from './components/AddLoadForm.jsx'
import { fetchJson, postJson } from './lib/api.js'
import { fetchMe, logout } from './lib/auth.js'
import { sortLoads } from './lib/sortLoads.js'

// ---------------------------------------------------------------------------
// App is the "container" component. It owns the data and the filter settings,
// and hands pieces of both down to smaller components as props.
//
// The rule this follows is "lift state up": when two components need the same
// piece of data, that data lives in their closest common parent. LoadFilters
// changes the filter, LoadTable reads it -- so the filter lives here, in App.
// ---------------------------------------------------------------------------
export default function App() {
  // The search box IS the URL -- there is no useState behind it.
  //
  // It used to be seeded from ?search= once and then kept in component state,
  // which meant the address bar went stale the moment anyone typed: still
  // saying ?search=1234 while the box showed something else. Holding it in one
  // place removes that possibility rather than managing it, and a filtered
  // board becomes something you can link, bookmark, and reload.
  //
  // `replace` and not push: pushing would stack one history entry per
  // KEYSTROKE, so backing out of a ten-character search would take ten presses.
  // With replace the board's filter is part of where you are, not part of how
  // you got there.
  //
  // An empty box deletes the parameter instead of setting it to "", so a
  // cleared search leaves "/" rather than "/?search=".
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('search') || ''
  const [sortKey, setSortKey] = useState(null) // e.g. 'miles'
  const [sortDir, setSortDir] = useState('asc') // 'asc' | 'desc'
  const setSearch = (next) => {
    setSearchParams(
      (prev) => {
        // Built from prev rather than from scratch so this stays correct when
        // the board grows a second parameter -- writing { search } would drop
        // every other one.
        const params = new URLSearchParams(prev)
        if (next) params.set('search', next)
        else params.delete('search')
        return params
      },
      { replace: true }
    )
  }

  // Clicking a header either flips the direction (same column) or moves the
  // sort to a new column, starting ascending.
  const handleSort = (key) => {
    if (key === sortKey) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

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

  // equipment and availableOnly stay ordinary state on purpose. The load link
  // on a pay statement carries a search term, so that one has to survive being
  // pasted somewhere; nothing links to a particular equipment filter.
  const [equipment, setEquipment] = useState('All')
  const [availableOnly, setAvailableOnly] = useState(false)

  // Who is signed in. Kept here rather than in AddLoadForm because it is one
  // answer for the whole page, and asking twice would mean two requests.
  //
  // Three states, not two: `undefined` until /api/me answers, then an account
  // or null. Starting at null instead would be a claim we cannot support yet,
  // and the visible cost is a "Sign in" prompt flashing at someone who is
  // already signed in.
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
  // questions: who is signed in, and what freight exists. Sharing an effect
  // would make the board wait on the identity check, or the identity check
  // wait on the board -- and the board is the reason people are here.
  useEffect(() => {
    let cancelled = false
    fetchMe()
      .then((account) => {
        if (!cancelled) setUser(account)
      })
      .catch(() => {
        // Being unable to ask is the same as not being signed in, as far as
        // this page is concerned. The board is public either way, and every
        // route that matters is gated on the server.
        if (!cancelled) setUser(null)
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

    // WHICH rows to show. One load in, yes or no out.
    const filtered = loads.filter((load) => {
      if (equipment !== 'All' && load.equipment !== equipment) return false
      if (availableOnly && load.status !== 'Available') return false
      if (term) {
        const haystack = `${load.id} ${load.origin} ${load.destination}`.toLowerCase()
        if (!haystack.includes(term)) return false
      }
      return true
    })

    // WHAT ORDER to show them in. sortLoads returns `filtered` untouched when
    // no column is chosen, so the board keeps the order the API sent until
    // somebody clicks a header. See src/lib/sortLoads.js.
    return sortLoads(filtered, sortKey, sortDir)
  }, [loads, search, equipment, availableOnly, sortKey, sortDir])

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
      {/* Links, not buttons: these change the page, and a link is what the
          browser already knows how to open in a new tab.

          Settlements used to list every driver. That was fine at two and
          unreadable at twenty, which is what the settlements board is for --
          it filters, which a wall of names cannot.

          <Link to> rather than <a href>: an anchor makes the browser discard
          the whole app and build it again from nothing, so every move between
          pages re-ran /api/me. Link asks the router to swap the component and
          leaves React running, so the answer we already have is still there.
          It still renders a real <a> underneath -- middle-click and "open in
          new tab" work exactly as before.

          Above the header rather than below the table: the board is long
          enough that the bottom of the page is only reachable by scrolling
          past 177 rows, which made "Sign in" effectively hidden to anyone who
          did not already know it was there. */}
      <nav className="board-nav board-nav-top">
        <Link to="/settlements">Driver settlements →</Link>
        {/* Rendered only when nobody is signed in. `user === undefined` means
            /api/me has not answered, and offering "sign in" to somebody who
            already is looks broken. */}
        {user === null && <Link to="/signin">Sign in →</Link>}
        {user && user.role === 'admin' && <Link to="/admin">Accounts →</Link>}        
        {user === null && <Link to="/register">Create an account</Link>}
      </nav>

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
        <LoadTable loads={visibleLoads} 
        sortKey={sortKey} sortDir={sortDir} onSort={handleSort}/>
      )}

      {/* The same "database is asleep" message the first load shows, for the
          save that runs into it. Without this a POST during a wake-up is a
          disabled button and a minute of nothing. */}
      {!loading && waking && (
        <p className="muted">
          Waking the database — this can take up to a minute after a quiet spell.
        </p>
      )}

      {/* The server decides this -- identity.can(user, 'addLoad') in the
          function, which is the only check that matters. Repeating the rule
          here just means the form is absent rather than present-and-refusing,
          and if the two ever disagree the server wins and the person sees a
          403 they did not expect. */}
      <AddLoadForm
        onAddLoad={handleAddLoad}
        user={user}
        canAdd={Boolean(user) && (user.role === 'dispatcher' || user.role === 'admin')}
      />

      {user && (
        <p className="muted signin-note">
          Signed in as {user.displayName || user.email}
          {user.role !== 'none' && ` · ${user.role}`}
          {' · '}
          <button
            type="button"
            className="linklike"
            onClick={async () => {
              // Ask the server to revoke the session, then reload. Clearing
              // only the cookie would leave a token that still works for
              // anyone who copied it.
              try { await logout() } catch { /* leaving anyway */ }
              window.location.href = '/'
            }}
          >
            Sign out
          </button>
        </p>
      )}

      {user && user.pendingApproval && (
        <p className="muted signin-note">
          Your account is waiting for an administrator to approve it. Until then
          you can read the board but not change it.
        </p>
      )}

    </div>
  )
}
