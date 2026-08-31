import { useState, useEffect } from 'react'
import { fetchJson } from '../lib/api.js'
import { formatMoney, formatMiles, formatDate } from '../lib/format.js'
import EarningsByLoad from '../components/settlement/EarningsByLoad.jsx'
import LineSection from '../components/settlement/LineSection.jsx'

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

export default function Settlement({ driverCode }) {
  const [checkDates, setCheckDates] = useState([])
  const [selected, setSelected] = useState('')
  const [statement, setStatement] = useState(null)

  const [loading, setLoading] = useState(true)
  const [waking, setWaking] = useState(false)
  const [error, setError] = useState(null)

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
          setSelected(dates[0].checkDate)
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
        setWaking(false)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [driverCode])

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
        setWaking(false)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [driverCode, selected])

  if (error) {
    return (
      <div className="page">
        <header>
          <h1>Settlement</h1>
        </header>
        <div className="error">{error}</div>
        <p>
          <a href="./">Back to the load board</a>
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
        <a href="./">← Load board</a>
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
          that matters. Net pay goes here because it is the first thing a
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
            <span>Net pay</span> {formatMoney(totals.netPay)}
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
          <div>Net pay</div>
          <div className="num">{formatMoney(totals.netPay)}</div>
        </div>
      </div>
    </div>
  )
}
