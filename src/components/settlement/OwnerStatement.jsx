import { formatMoney, formatMiles, formatDate, formatPercent, formatRate } from '../../lib/format.js'
import { COMPANY } from '../../lib/company.js'
import EarningsByLoad from './EarningsByLoad.jsx'
import LinesByLoad from './LinesByLoad.jsx'
import WeeklyYtd from './WeeklyYtd.jsx'
import EscrowSummary from './EscrowSummary.jsx'

// ---------------------------------------------------------------------------
// The owner/operator settlement -- the port of ownDrvSettlement.cfm.
//
// An owner/operator owns the truck and contracts to the carrier as a business.
// That makes this a different document from the company statement next door,
// in three ways that drive everything below:
//
//   1. EVERY FIGURE IS SHOWN WEEKLY AND YEAR TO DATE. A contractor cannot tell
//      from one week whether the business works. The original built its whole
//      page around this comparison and it is the right instinct.
//
//   2. THE DEDUCTIONS ARE BUSINESS COSTS, not payroll withholding. Fuel, the
//      truck payment, insurance, the trailer -- these are what it costs to run
//      the truck, and they dwarf anything on a company statement. Gross pay
//      here is not a number anybody should read on its own.
//
//   3. NOTHING IS WITHHELD FOR TAX. A 1099 contractor owes quarterly estimated
//      tax on what they clear, and no part of this document does that for them.
//      The closing note says so, and it is the single most consequential
//      sentence on the page.
//
// The order of the sections follows the original: summary first (the answer),
// then earnings and costs by load (what happened), then the details weekly
// against YTD (the trend), then escrow (what is being held). Someone opening
// their statement to check one number finds it at the top; someone working out
// whether last month was any good reads downward.
// ---------------------------------------------------------------------------
export default function OwnerStatement({ statement }) {
  const {
    driver,
    settlement,
    routes,
    reimbursements,
    perDiem,
    deductions,
    totals,
    ytd,
    comparison,
    escrow,
    escrowTotal,
  } = statement

  // Per diem is folded back in rather than shown separately. On the company
  // statement it is its own block because payroll substantiates it; for a 1099
  // contractor it is just another reimbursement, and the API returns the two
  // apart only because one payload serves both documents.
  const allReimbursements = [...perDiem, ...reimbursements]

  return (
    <>
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
          {/* Named differently from the company statement on purpose. This is
              a settlement between two businesses, not a pay statement issued
              by an employer, and the driver's own accountant will call it
              that. */}
          <div className="stmt-meta-title">Owner/Operator Settlement</div>
          <div>
            <span>Period start</span> {formatDate(settlement.periodStart)}
          </div>
          <div>
            <span>Period end</span> {formatDate(settlement.periodEnd)}
          </div>
          <div>
            <span>Settlement date</span> {formatDate(settlement.checkDate)}
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
          {/* "Contractor no", not "Employee no". The word is the difference
              between the two documents and there is no reason to blur it. */}
          <div>
            <span>Contractor no</span> {driver.driverCode}
          </div>
          <div>
            <span>Tax ID</span> ***-**-{driver.ssnLast4}
          </div>
          {/* "Pay basis" and "Pay group" rather than "Settlement basis" and
              "Settlement group": the document is already titled a settlement,
              so the word earns nothing here, and both fit the label column
              without squeezing the value beside them. "Pay group" is also what
              the company statement calls the same field. */}
          <div>
            <span>Pay basis</span>{' '}
            {driver.payBasis === 'PERCENTAGE' ? 'Percentage of linehaul' : 'Per mile'}
          </div>
          <div>
            <span>{driver.payBasis === 'PERCENTAGE' ? 'Share' : 'Rate'}</span>{' '}
            {driver.payBasis === 'PERCENTAGE'
              ? formatPercent(driver.payRate)
              : formatRate(driver.payRate)}
          </div>
        </div>
        <div>
          <div>
            <span>Unit</span> {driver.unitNo || '—'}
          </div>
          <div>
            <span>Truck</span> {driver.truckDescription || '—'}
          </div>
          <div>
            <span>Location</span> {driver.location}
          </div>
          <div>
            <span>Pay group</span> {driver.payGroup}
          </div>
        </div>
      </div>

      {/* The summary: the whole statement in four rows. Deliberately first --
          the original put it here too, and it is the only part most people
          read most weeks. */}
      <WeeklyYtd
        title="Summary"
        variant="summary"
        lines={[
          { description: 'Compensation', ...comparison.compensation },
          { description: 'Reimbursements', ...comparison.reimbursements },
          { description: 'Deductions', ...comparison.deductions },
        ]}
        weekly={comparison.total.weekly}
        ytd={comparison.total.ytd}
      />

      <EarningsByLoad routes={routes} totals={totals} payBasis={driver.payBasis} />

      <LinesByLoad
        title="Reimbursements by Load"
        lines={allReimbursements}
        routes={routes}
        emptyNote="No reimbursements were attributed to a load this settlement."
      />

      <LinesByLoad
        title="Deductions by Load"
        lines={deductions}
        routes={routes}
        emptyNote="No deductions were attributed to a specific load this settlement — the fixed costs are in the details below."
      />

      <div className="stmt-block">
        <h2>Details</h2>
        <div className="stmt-details">
          <WeeklyYtd
            title="Compensation"
            lines={comparison.compensation.lines}
            weekly={comparison.compensation.weekly}
            ytd={comparison.compensation.ytd}
          />
          <WeeklyYtd
            title="Reimbursements"
            lines={comparison.reimbursements.lines}
            weekly={comparison.reimbursements.weekly}
            ytd={comparison.reimbursements.ytd}
          />
          <WeeklyYtd
            title="Deductions"
            lines={comparison.deductions.lines}
            weekly={comparison.deductions.weekly}
            ytd={comparison.deductions.ytd}
          />
        </div>
      </div>

      <EscrowSummary escrow={escrow} total={escrowTotal} />

      <div className="stmt-block stmt-summary">
        <div className="stmt-row">
          <div>Miles this settlement</div>
          <div className="num">{formatMiles(totals.totalMiles)}</div>
        </div>
        <div className="stmt-row">
          <div>Year-to-date miles</div>
          <div className="num">{formatMiles(ytd.totalMiles)}</div>
        </div>
        <div className="stmt-row">
          <div>Year-to-date settlement</div>
          <div className="num">{formatMoney(comparison.total.ytd)}</div>
        </div>
        <div className="stmt-row stmt-net">
          <div>Settlement total</div>
          <div className="num">{formatMoney(totals.settlementTotal)}</div>
        </div>
        {/* The most important sentence on the page. A company driver's
            statement warns that tax comes out later and payroll handles it.
            Here nobody handles it, and a contractor who reads this figure as
            take-home is one who has not set aside their quarterly payment. */}
        <p className="stmt-note muted">
          Compensation and reimbursements less the deductions shown above. As an
          independent contractor you are paid this amount in full — no tax is
          withheld, and estimated tax on it remains your responsibility.
        </p>
      </div>
    </>
  )
}
