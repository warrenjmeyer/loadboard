import { Link } from 'react-router-dom'
import { formatMoney, formatMiles, formatRate } from '../../lib/format.js'

// ---------------------------------------------------------------------------
// "Earnings by load" -- one row per route, then a totals row.
//
// The rate column: the API sends `rpm` computed the way the original did, but
// the original fell back to putting the flat dollar amount in the rate column
// when a line had no miles. A layover paid at $150 then displayed a rate of
// "150", which reads as $150 per mile. This shows an em dash instead: a flat
// payment does not have a rate per mile, and saying so is more useful than
// filling the cell.
// ---------------------------------------------------------------------------
export default function EarningsByLoad({ routes, totals }) {
  return (
    <div className="stmt-block">
      <h2>Earnings by Load</h2>

      <div className="stmt-table">
        <div className="stmt-row stmt-head">
          <div>Load</div>
          <div>Route</div>
          <div className="num">Empty</div>
          <div className="num">Loaded</div>
          <div className="num">Total</div>
          <div className="num">Rate</div>
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
            <div className="num">{r.totalMiles > 0 ? formatRate(r.rpm) : '—'}</div>
            <div className="num">{formatMoney(r.payAmount)}</div>
          </div>
        ))}

        <div className="stmt-row stmt-subtotal">
          <div />
          <div />
          <div className="num">{formatMiles(totals.emptyMiles)}</div>
          <div className="num">{formatMiles(totals.loadedMiles)}</div>
          <div className="num">{formatMiles(totals.totalMiles)}</div>
          <div className="num" />
          <div className="num">{formatMoney(totals.routePay)}</div>
        </div>
      </div>
    </div>
  )
}
