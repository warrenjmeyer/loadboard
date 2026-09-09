import { Link } from 'react-router-dom'
import { formatMoney, formatMiles, formatDate, formatRate } from '../../lib/format.js'

// ---------------------------------------------------------------------------
// What a pay run would create, one row per driver, each opening to the loads
// behind it. Presentational: the page owns which drivers are ticked and
// what happens when the button is pressed.
//
// A conflict row -- the driver already has a statement on this check date --
// is shown and cannot be ticked. Carried-over loads are marked, because a
// straggler from last week deserves a second look before it is paid.
// ---------------------------------------------------------------------------
export default function PayrunPreview({ plan, selected, onToggle }) {
  if (!plan.settlements.length) {
    return <p className="muted">Nothing to pay: no unpaid delivered loads on or before {formatDate(plan.periodEnd)}.</p>
  }

  return (
    <div className="table-scroll">
      <table className="loads payrun">
        <thead>
          <tr>
            <th />
            <th>Driver</th>
            <th>Paid</th>
            <th className="num">Loads</th>
            <th className="num">Loaded</th>
            <th className="num">Empty</th>
            <th className="num">Total mi</th>
            <th className="num">Rate</th>
            <th className="num">Route pay</th>
          </tr>
        </thead>
        <tbody>
          {plan.settlements.map((s) => (
            <tr key={s.driverCode} className={s.conflict ? 'row-off' : undefined}>
              <td>
                <input
                  type="checkbox"
                  checked={selected.has(s.driverCode)}
                  disabled={s.conflict}
                  onChange={() => onToggle(s.driverCode)}
                  aria-label={`Include ${s.name}`}
                />
              </td>
              <td>
                <details>
                  <summary>
                    {s.name} <span className="mono muted">{s.driverCode}</span>
                    {s.driverType === 'OWNER' && <span className="badge badge-oo">O/O</span>}
                    {s.conflict && <span className="badge badge-hold">already paid {formatDate(plan.checkDate)}</span>}
                    {s.carriedOver > 0 && <span className="badge badge-in-transit">{s.carriedOver} carried over</span>}
                  </summary>
                  <table className="payrun-loads">
                    <tbody>
                      {s.routes.map((r) => (
                        <tr key={r.loadId} className={r.carriedOver ? 'due-soon' : undefined}>
                          <td className="mono"><Link to={`/loads/${encodeURIComponent(r.loadId)}`}>{r.loadId}</Link></td>
                          <td>{r.routeDetail}</td>
                          <td className="nowrap">{formatDate(r.deliveredDate)}{r.carriedOver ? ' · before period' : ''}</td>
                          <td className="num">{formatMiles(r.totalMiles)} mi</td>
                          <td className="num">{formatMoney(r.payAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </td>
              <td>{s.driverType === 'OWNER' ? (s.payBasis === 'PERCENTAGE' ? 'share of revenue' : 'per mile') : 'per mile'}</td>
              <td className="num">{s.loadCount}</td>
              <td className="num">{formatMiles(s.loadedMiles)}</td>
              <td className="num">{formatMiles(s.emptyMiles)}</td>
              <td className="num">{formatMiles(s.totalMiles)}</td>
              <td className="num">{s.payBasis === 'PERCENTAGE' ? `${Math.round(s.payRate * 100)}%` : formatRate(s.payRate)}</td>
              <td className="num">{formatMoney(s.routePay)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td />
            <td colSpan={2}>{plan.totals.drivers} drivers</td>
            <td className="num">{plan.totals.loads}</td>
            <td colSpan={2} />
            <td className="num">{formatMiles(plan.totals.miles)}</td>
            <td />
            <td className="num">{formatMoney(plan.totals.pay)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
