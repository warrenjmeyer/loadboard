import { useState, useEffect, useMemo } from 'react'
import { fetchJson } from '../lib/api.js'
import { formatMoney, formatMiles } from '../lib/format.js'
import SettlementFilters from '../components/SettlementFilters.jsx'
import SettlementTable from '../components/SettlementTable.jsx'
import AccessNotice from '../components/AccessNotice.jsx'

// ---------------------------------------------------------------------------
// The settlements board: every settlement across the fleet, filterable.
//
// Deliberately the same shape as App.jsx -- owns the data and the filters,
// derives the visible list, hands pieces down to dumb components. If you can
// read one you can read the other, and that is worth more than any cleverness
// that would make them differ.
//
// The individual statement lives at ?id=DRIVERCODE. This board links to it.
// ---------------------------------------------------------------------------
export default function Settlements() {
  const [settlements, setSettlements] = useState([])
  const [loading, setLoading] = useState(true)
  const [waking, setWaking] = useState(false)
  const [error, setError] = useState(null)
  // Kept beside the message because 401, 403 and "the database fell over" are
  // three different things to say, and only the status tells them apart.
  const [errorStatus, setErrorStatus] = useState(null)

  const [search, setSearch] = useState('')
  const [payDate, setPayDate] = useState('All')
  const [withDeductionsOnly, setWithDeductionsOnly] = useState(false)

  useEffect(() => {
    let cancelled = false

    fetchJson('/api/settlements', {
      onWaking: () => !cancelled && setWaking(true),
    })
      .then((data) => {
        if (cancelled) return
        setSettlements(data)
        setWaking(false)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setErrorStatus(err.status ?? null)
        setWaking(false)
        setLoading(false)
      })

    // A refusal replaces the page rather than appearing inside it. Rendering it
  // inline left "Not available to your account" sandwiched between the header
  // and a filter bar over an empty table, which reads as a broken page rather
  // than an answer -- and still showed "0 of 0 settlements" as if the number
  // were real.
  if (error && (errorStatus === 401 || errorStatus === 403)) {
    return <AccessNotice error={error} status={errorStatus} />
  }

  return () => {
      cancelled = true
    }
  }, [])

  // Derived, not stored. The pay dates in the dropdown come from the data
  // rather than a hardcoded list, so a new payroll run appears on its own.
  const payDates = useMemo(
    () => [...new Set(settlements.map((s) => s.checkDate))].sort().reverse(),
    [settlements]
  )

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()

    return settlements.filter((s) => {
      if (payDate !== 'All' && s.checkDate !== payDate) return false
      if (withDeductionsOnly && !s.hasDeductions) return false
      if (term) {
        const haystack = `${s.driverName} ${s.documentNo} ${s.driverCode}`.toLowerCase()
        if (!haystack.includes(term)) return false
      }
      return true
    })
  }, [settlements, search, payDate, withDeductionsOnly])

  // Totals reflect what is on screen, not the whole table. A filtered board
  // whose summary still describes everything is worse than no summary.
  const totalPaid = visible.reduce((sum, s) => sum + s.settlementTotal, 0)
  const totalMiles = visible.reduce((sum, s) => sum + s.miles, 0)

  return (
    <div className="page">
      <header>
        <h1>Driver Settlements</h1>
        <p className="sub">
          {loading
            ? waking
              ? 'Waking the database...'
              : 'Loading...'
            : `${visible.length} of ${settlements.length} settlements`}
          {!loading && totalPaid > 0 && ` · ${formatMoney(totalPaid)} · ${formatMiles(totalMiles)} mi`}
        </p>
      </header>



      {error && <AccessNotice error={error} status={errorStatus} />}

      <SettlementFilters
        search={search}
        payDate={payDate}
        payDates={payDates}
        withDeductionsOnly={withDeductionsOnly}
        onSearchChange={setSearch}
        onPayDateChange={setPayDate}
        onWithDeductionsOnlyChange={setWithDeductionsOnly}
      />

      {loading ? (
        <p className="muted">
          {waking
            ? 'The database pauses when it is idle. Waking it takes up to a minute — this only happens on the first visit after a quiet spell.'
            : 'Fetching settlements...'}
        </p>
      ) : (
        <SettlementTable settlements={visible} />
      )}

      <nav className="board-nav">
        <a href="./">← Load board</a>
      </nav>
    </div>
  )
}
