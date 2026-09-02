import { useState, useEffect } from 'react'
import { fetchJson } from '../lib/api.js'
import { formatMoney, formatMiles, formatDate } from '../lib/format.js'
import EarningsByLoad from '../components/settlement/EarningsByLoad.jsx'
import LineSection from '../components/settlement/LineSection.jsx'
import AccessNotice from '../components/AccessNotice.jsx'

// ---------------------------------------------------------------------------
// The company-driver settlement (pay statement).
//
// Reached as ?id=JSMITH, the same way the ColdFusion original used url.id, and
// the check date is chosen from a dropdown exactly as it was there. Two
// fetches: the list of check dates, then the selected statement.
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

export default function Settlement({ driverCode, initialCheckDate }) {
  const [checkDates, setCheckDates] = useState([])
  const [selected, setSelected] = useState('')
  const [statement, setStatement] = useState(null)

  const [loading, setLoading] = useState(true)
  const [waking, setWaking] = useState(false)
  const [error, setError] = useState(null)
  // 401, 403 and a genuine failure need three different pages, and only the
  // status separates them. A driver opening someone else's statement gets 403,
  // and offering them a sign-in link would send them round a loop that cannot
  // end -- they are already signed in; that is the whole problem.
  const [errorStatus, setErrorStatus] = useState(null)

  // First effect: which check dates does this driver have? Also picks the most
  // recent one, which is what someone opening their pay statement wants to see.
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
        if (dates.length) {
          // A ?date= from the settlements board wins, so a link lands on the
          // statement it named. Falling back to the newest matters when the
          // date is stale or absent: showing a driver the wrong pay period is
          // worse than ignoring the parameter.
          const wanted = dates.find((d) => d.checkDate === initialCheckDate)
          setSelected(wanted ? wanted.checkDate : dates[0].checkDate)
        } else {
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
  }, [driverCode, initialCheckDate])

  // Second effect: load the selected statement. Depends on `selected`, so
  // changing the dropdown re-runs it -- this is the case the empty dependency
  // array in App.jsx deliberately does not have.
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
          <a href="?view=settlements">Back to the settlements board</a>
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
          <a href="?view=settlements">← Settlements</a>
          <a href="./">Load board</a>
        </nav>
        <label>
          Check date
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
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
