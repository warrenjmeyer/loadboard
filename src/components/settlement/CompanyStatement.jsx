import { formatMoney, formatMiles, formatDate } from '../../lib/format.js'
import { COMPANY } from '../../lib/company.js'
import EarningsByLoad from './EarningsByLoad.jsx'
import LineSection from './LineSection.jsx'

// ---------------------------------------------------------------------------
// The company-driver pay statement.
//
// This is the body that used to live inline in pages/Settlement.jsx. It moved
// out unchanged when the owner/operator statement arrived: the page is now a
// shell that fetches, and picks one of these two documents to draw. Nothing
// here knows about routing or loading -- it takes a statement and renders it.
//
// A company driver is a W-2 employee. The deductions here are the ones payroll
// takes out of gross pay, and tax is NOT among them -- see the note at the
// bottom, which is the most important sentence on the page.
// ---------------------------------------------------------------------------
export default function CompanyStatement({ statement }) {
  const {
    driver,
    settlement,
    routes,
    revenue,
    perDiem,
    reimbursements,
    deductions,
    totals,
    ytd,
  } = statement

  return (
    <>
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
    </>
  )
}
