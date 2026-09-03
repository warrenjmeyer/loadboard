import { useState, useEffect } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { fetchJson } from '../lib/api.js'
import { formatDate } from '../lib/format.js'
import CompanyStatement from '../components/settlement/CompanyStatement.jsx'
import OwnerStatement from '../components/settlement/OwnerStatement.jsx'
import AccessNotice from '../components/AccessNotice.jsx'

// ---------------------------------------------------------------------------
// The settlement page -- a shell around one of two statements.
//
// It owns everything that is the same either way: reading the URL, fetching,
// the loading and refusal states, the back links and the check-date dropdown.
// What a settlement LOOKS like is not its business -- it hands the payload to
// CompanyStatement or OwnerStatement and lets that component draw. The two
// documents diverge enough (see OwnerStatement for how much) that interleaving
// them here with conditionals would make both harder to read than either is
// alone.
//
// *** This file is the worked example for the router migration. ***
//
// It was reached as ?id=JSMITH&date=2026-08-28, the same way the ColdFusion
// original used url.id, and main.jsx read both parameters and passed them down
// as props. It now lives at:
//
//   /settlements/JSMITH?date=2026-08-28
//
// which splits one thing into two on purpose, and the split is the lesson:
//
//   :driverCode is part of the PATH, read with useParams(). It identifies
//   which resource this page is. Change it and you are on a different page.
//
//   ?date= is a SEARCH parameter, read with useSearchParams(). It is a view
//   setting on the same resource -- which pay period of this driver's. Change
//   it and you are on the same page, looking at it differently.
//
// The practical payoff is the back button. Because the date now lives in the
// URL rather than in useState, picking three check dates from the dropdown
// leaves three history entries, and Back walks them. Under the old code the
// dropdown changed state only, Back left the statement entirely, and the
// ?date= a link arrived with was forgotten the moment you touched the select.
//
// The carrier's own name and address moved to lib/company.js when the second
// statement arrived -- both mastheads print it, and two copies is one copy too
// many for a document whose job is to be trusted.
// ---------------------------------------------------------------------------

export default function Settlement() {
  // The path parameter. Named by the ":driverCode" in main.jsx's Route -- the
  // string has to match, and a typo here is an undefined that only shows up as
  // a 404 from the API three steps later.
  const { driverCode } = useParams()

  // The search parameter. useSearchParams is deliberately shaped like
  // useState: a value and a setter. The difference is where the value lives --
  // in the URL, so it survives a reload, a bookmark, and a paste into Slack.
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedDate = searchParams.get('date')

  const [checkDates, setCheckDates] = useState([])
  const [statement, setStatement] = useState(null)

  // NOT state. The selected date is derived: it is whatever the URL asks for,
  // but only once we know that date actually exists for this driver. Keeping a
  // `selected` useState in sync with the URL by hand is the two-sources-of-
  // truth bug that this whole exercise exists to teach you to avoid.
  const selected = checkDates.some((d) => d.checkDate === requestedDate)
    ? requestedDate
    : ''

  const [loading, setLoading] = useState(true)
  const [waking, setWaking] = useState(false)
  const [error, setError] = useState(null)
  // 401, 403 and a genuine failure need three different pages, and only the
  // status separates them. A driver opening someone else's statement gets 403,
  // and offering them a sign-in link would send them round a loop that cannot
  // end -- they are already signed in; that is the whole problem.
  const [errorStatus, setErrorStatus] = useState(null)

  // First effect: which check dates does this driver have?
  //
  // It no longer picks one. Choosing the default is now a separate concern,
  // because the answer lives in the URL and this effect must not re-run every
  // time the URL changes -- that would re-fetch the date list on every move of
  // the dropdown. Note the dependency array is [driverCode] alone.
  useEffect(() => {
    let cancelled = false

    setLoading(true)
    setError(null)

    fetchJson(`/api/drivers/${encodeURIComponent(driverCode)}/settlements`, {
      onWaking: () => !cancelled && setWaking(true),
    })
      .then((dates) => {
        if (cancelled) return
        setCheckDates(dates)
        setWaking(false)
        if (!dates.length) {
          setStatement(null)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (cancelled) return
        setError(
          err.status === 404
            ? `No settlements found for driver ${driverCode}.`
            : err.message
        )
        setErrorStatus(err.status ?? null)
        setWaking(false)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [driverCode])

  // Canonicalise the URL once the dates are known.
  //
  // A ?date= from the settlements board wins, so a link lands on the statement
  // it named. Falling back to the newest matters when the date is stale or
  // absent: showing a driver the wrong pay period is worse than ignoring the
  // parameter, and a bare /settlements/JSMITH has to resolve to something.
  //
  // { replace: true } is the important half. This rewrite is not a navigation
  // the person made -- it is the app finishing their sentence. Pushing it
  // would mean Back returns to the un-canonical URL, which immediately
  // rewrites itself again, and the back button stops working. Any redirect you
  // perform on someone's behalf wants replace.
  useEffect(() => {
    if (!checkDates.length) return
    if (checkDates.some((d) => d.checkDate === requestedDate)) return

    setSearchParams({ date: checkDates[0].checkDate }, { replace: true })
  }, [checkDates, requestedDate, setSearchParams])

  // Second effect: load the selected statement. Depends on `selected`, which
  // now comes from the URL -- so changing the dropdown, following a link, and
  // pressing Back all arrive here by the same path. That uniformity is most of
  // what a router buys you.
  useEffect(() => {
    if (!selected) return

    let cancelled = false
    setLoading(true)
    setError(null)

    fetchJson(
      `/api/drivers/${encodeURIComponent(driverCode)}/settlements/${selected}`,
      { onWaking: () => !cancelled && setWaking(true) }
    )
      .then((data) => {
        if (cancelled) return
        setStatement(data)
        setWaking(false)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.status === 404 ? 'That settlement no longer exists.' : err.message)
        setErrorStatus(err.status ?? null)
        setWaking(false)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [driverCode, selected])

  if (error) {
    // A refusal is its own page, not an error banner inside a statement that
    // was never loaded. AccessNotice renders the sign-in prompt for a 401 and
    // a plain "not yours" for a 403.
    if (errorStatus === 401 || errorStatus === 403) {
      return <AccessNotice error={error} status={errorStatus} />
    }

    return (
      <div className="page">
        <header>
          <h1>Settlement</h1>
        </header>
        <div className="error">{error}</div>
        <p>
          {/* <Link> renders a real <a> with a real href -- so middle-click,
              "open in new tab" and copy-link all still work -- but it
              intercepts the plain click and swaps the component instead of
              reloading the document. That is the entire difference. */}
          <Link to="/settlements">Back to the settlements board</Link>
        </p>
      </div>
    )
  }

  if (loading && !statement) {
    return (
      <div className="page">
        <header>
          <h1>Settlement</h1>
        </header>
        <p className="muted">
          {waking
            ? 'The database pauses when it is idle. Waking it takes up to a minute — this only happens on the first visit after a quiet spell.'
            : 'Loading settlement...'}
        </p>
      </div>
    )
  }

  if (!statement) {
    return (
      <div className="page">
        <header>
          <h1>Settlement</h1>
        </header>
        <p className="muted">No settlements found for driver {driverCode}.</p>
      </div>
    )
  }

  // ONE ROUTE, TWO DOCUMENTS.
  //
  // The driver's type decides which statement this is, and it arrives with the
  // data rather than being encoded in the URL. That is the whole reason
  // /settlements/:driverCode stays the only address: a driver following a link
  // to their own statement should not have to know which kind of contract they
  // are on, and the settlements board should not have to look it up to build a
  // href. Change a driver from company to owner/operator in the database and
  // every existing link to them keeps working and starts showing the right
  // document.
  //
  // Defaulting to the company statement is deliberate. driver_type is NOT NULL
  // with a default of COMPANY, so 'OWNER' is the only value that can branch --
  // but if this API ever answers with a type nobody has taught this page about,
  // rendering the familiar document beats rendering nothing.
  const isOwnerOperator = statement.driver.driverType === 'OWNER'

  return (
    <div className="page stmt">
      <div className="stmt-toolbar">
        <nav className="stmt-back">
          <Link to="/settlements">← Settlements</Link>
          <Link to="/">Load board</Link>
        </nav>
        <label>
          Check date
          {/* Still a controlled input -- value comes from above, onChange
              reports up. The only change is what "above" means: the URL rather
              than a useState. Because this one pushes (no replace), every date
              you look at is a history entry you can walk back through. */}
          <select
            value={selected}
            onChange={(e) => setSearchParams({ date: e.target.value })}
          >
            {checkDates.map((d) => (
              <option key={d.checkDate} value={d.checkDate}>
                {formatDate(d.checkDate)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isOwnerOperator ? (
        <OwnerStatement statement={statement} />
      ) : (
        <CompanyStatement statement={statement} />
      )}
    </div>
  )
}
