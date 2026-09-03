import { Link } from 'react-router-dom'
import { formatMoney, formatMiles, formatRate, formatPercent } from '../../lib/format.js'

// ---------------------------------------------------------------------------
// "Earnings by load" -- one row per route, then a totals row.
//
// THE PAY COLUMNS DEPEND ON THE CONTRACT, and this is the only place in the
// app where that is true, so it is worth being explicit about why.
//
//   payBasis undefined (a company driver) or 'MILEAGE'
//       ... Total | Rate | Pay      -- pay is miles x rate
//
//   payBasis 'PERCENTAGE'
//       ... Total | Revenue | Share | Pay   -- pay is revenue x share
//
// A percentage contract pays a cut of what the load billed, so the miles are
// still worth showing -- they are the driver's fuel and wear -- but they are
// not what the money is computed from. Printing a "rate per mile" as the
// headline number on a percentage settlement would name a figure that appears
// in no contract and that the driver cannot check against anything. The
// revenue and the share ARE checkable: revenue is on the load board, and the
// share is in the contract.
//
// The rate column on a mileage statement: the API sends `rpm` computed the way
// the original did, but the original fell back to putting the flat dollar
// amount in the rate column when a line had no miles. A layover paid at $150
// then displayed a rate of "150", which reads as $150 per mile. This shows an
// em dash instead: a flat payment does not have a rate per mile, and saying so
// is more useful than filling the cell.
// ---------------------------------------------------------------------------
export default function EarningsByLoad({ routes, totals, payBasis }) {
  const isPercentage = payBasis === 'PERCENTAGE'

  const revenueTotal = isPercentage
    ? routes.reduce((t, r) => t + (r.linehaulRevenue ?? 0), 0)
    : 0

  return (
    <div className="stmt-block">
      <h2>Earnings by Load</h2>

      <div className={`stmt-table${isPercentage ? ' stmt-table-pct' : ''}`}>
        <div className="stmt-row stmt-head">
          <div>Load</div>
          <div>Route</div>
          <div className="num">Empty</div>
          <div className="num">Loaded</div>
          <div className="num">Total</div>
          {isPercentage && <div className="num">Revenue</div>}
          <div className="num">{isPercentage ? 'Share' : 'Rate'}</div>
          <div className="num">Pay</div>
        </div>

        {routes.map((r) => (
          <div className="stmt-row" key={`${r.orderNo}-${r.dispatchNo ?? ''}`}>
            {/* Linked to the load it was, so a driver can trace a line on
                their statement back to the freight. A SPECIAL line -- layover,
                breakdown -- has no load, so it stays plain text rather than
                pretending to lead somewhere.

                The leading "/" is the whole point. This was `?search=...`,
                which a browser resolves against the current directory -- and
                the current directory here is /settlements/JSMITH, which is
                still the settlement route. Clicking a load number reloaded the
                same statement instead of taking anyone to the board. The
                target is the board, so the path has to say so. */}
            <div>
              {r.loadId ? (
                <Link to={`/?search=${encodeURIComponent(r.loadId)}`}>{r.orderNo}</Link>
              ) : (
                r.orderNo
              )}
            </div>
            <div className="stmt-route">{r.routeDetail}</div>
            <div className="num">{formatMiles(r.emptyMiles)}</div>
            <div className="num">{formatMiles(r.loadedMiles)}</div>
            <div className="num">{formatMiles(r.totalMiles)}</div>
            {isPercentage && (
              <div className="num">
                {r.linehaulRevenue === null ? '—' : formatMoney(r.linehaulRevenue)}
              </div>
            )}
            {/* Em dash, not a number, when the line has nothing to be a rate
                OF. A layover is a flat payment: it has no miles to divide by
                and no linehaul to take a share of, so both contracts print a
                dash. Showing "0%" there would say the driver's share of that
                money was nothing, which is the opposite of true -- they got
                all of it. */}
            <div className="num">
              {isPercentage
                ? r.linehaulRevenue === null
                  ? '—'
                  : formatPercent(r.payRate)
                : r.totalMiles > 0
                  ? formatRate(r.rpm)
                  : '—'}
            </div>
            <div className="num">{formatMoney(r.payAmount)}</div>
          </div>
        ))}

        <div className="stmt-row stmt-subtotal">
          <div />
          <div />
          <div className="num">{formatMiles(totals.emptyMiles)}</div>
          <div className="num">{formatMiles(totals.loadedMiles)}</div>
          <div className="num">{formatMiles(totals.totalMiles)}</div>
          {isPercentage && <div className="num">{formatMoney(revenueTotal)}</div>}
          <div className="num" />
          <div className="num">{formatMoney(totals.routePay)}</div>
        </div>
      </div>
    </div>
  )
}
