import { useState, useEffect } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { fetchJson } from '../lib/api.js'
import { formatMoney, formatMiles, formatDate } from '../lib/format.js'
import EarningsByLoad from '../components/settlement/EarningsByLoad.jsx'
import LineSection from '../components/settlement/LineSection.jsx'
import AccessNotice from '../components/AccessNotice.jsx'

// ---------------------------------------------------------------------------
// The company-driver settlement (pay statement).
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
// The company block is hardcoded. In the original it came from the payroll
// system, which this app has no equivalent of; inventing a table for one
// address would be worse than saying plainly that it is fixed.
// ---------------------------------------------------------------------------

const COMPANY = {
  name: 'Millstream',
  address: '2633 Jackson Street',
  city: 'Dubuque',
  state: 'IA',
  postalCode: '52001',
}

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

  const { driver, settlement, routes, revenue, perDiem, reimbursements, deductions, totals, ytd } =
    statement

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

      {/* Masthead: who paid, who was paid, for what period, and the number
          that matters. The total goes here because it is the first thing a
          driver looks for -- everything below is the explanation for it. */}
      <div className="stmt-masthead">
        <div>
          <div className="stmt-company">{COMPANY.name}</div>
          <div className="muted">
            {COMPANY.address}
            <br />
            {COMPANY.city}, {COMPANY.state} {COMPANY.postalCode}
          </div>
        </div>

        <div className="stmt-meta">
          <div className="stmt-meta-title">Pay Statement</div>
          <div>
            <span>Period start</span> {formatDate(settlement.periodStart)}
          </div>
          <div>
            <span>Period end</span> {formatDate(settlement.periodEnd)}
          </div>
          <div>
            <span>Pay date</span> {formatDate(settlement.checkDate)}
          </div>
          <div>
            <span>Document</span> {settlement.documentNo}
          </div>
          <div className="stmt-netpay">
            <span>Settlement total</span> {formatMoney(totals.settlementTotal)}
          </div>
        </div>
      </div>

      <div className="stmt-block stmt-driver">
        <div>
          <strong>
            {driver.firstName} {driver.lastName}
          </strong>
          <br />
          {driver.address1}
          {driver.address2 && (
            <>
              <br />
              {driver.address2}
            </>
          )}
          <br />
          {driver.city}, {driver.state} {driver.postalCode}
        </div>
        <div>
          <div>
            <span>Employee no</span> {driver.driverCode}
          </div>
          <div>
            <span>SSN</span> ***-**-{driver.ssnLast4}
          </div>
          <div>
            <span>Job</span> {driver.job}
          </div>
          <div>
            <span>Pay rate</span> {driver.payRate.toFixed(4)}
          </div>
        </div>
        <div>
          <div>
            <span>Pay group</span> {driver.payGroup}
          </div>
          <div>
            <span>Location</span> {driver.location}
          </div>
          <div>
            <span>Department</span> {driver.department}
          </div>
          <div>
            <span>Job type</span> {driver.jobType}
          </div>
        </div>
      </div>

      <EarningsByLoad routes={routes} totals={totals} />

      <div className="stmt-block">
        <h2>Adjustments</h2>
        <div className="stmt-table stmt-lines">
          <LineSection title="Other Earnings" lines={revenue} subtotal={totals.revenue} />
          <LineSection title="Per Diem" lines={perDiem} subtotal={totals.perDiem} />
          <LineSection
            title="Reimbursements"
            lines={reimbursements}
            subtotal={totals.reimbursements}
          />
          <LineSection title="Deductions" lines={deductions} subtotal={totals.deductions} />
        </div>
      </div>

      <div className="stmt-block stmt-summary">
        <div className="stmt-row">
          <div>Year-to-date miles</div>
          <div className="num">{formatMiles(ytd.totalMiles)}</div>
        </div>
        <div className="stmt-row stmt-net">
          <div>Settlement total</div>
          <div className="num">{formatMoney(totals.settlementTotal)}</div>
        </div>
        <p className="stmt-note muted">
          Earnings less the deductions shown above. Payroll withholds tax
          separately, so this is not take-home pay.
        </p>
      </div>
    </div>
  )
}
