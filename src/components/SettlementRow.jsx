import { Link } from 'react-router-dom'
import { formatMoney, formatMiles, formatDate } from '../lib/format.js'

// Presentational: data in, markup out, no state, no side effects -- the same
// contract as LoadRow.
//
// The document number is a link rather than the row being clickable. A link is
// something the browser already knows how to open in a new tab, copy, or
// middle-click; a row with an onClick is none of those things.
export default function SettlementRow({ settlement }) {
  // The driver code identifies the resource, so it goes in the path. The check
  // date selects a view of it, so it stays in the query string. Same split as
  // Settlement.jsx reads it back out with useParams / useSearchParams.
  //
  // encodeURIComponent on the path segment because a driver code is data, and
  // data with a "/" or a "?" in it would otherwise rewrite the route. Nothing
  // in the current fleet contains one; that is luck, not a guarantee.
  const to = `/settlements/${encodeURIComponent(settlement.driverCode)}?date=${settlement.checkDate}`

  return (
    <tr>
      <td className="mono">
        <Link to={to}>{settlement.documentNo}</Link>
      </td>
      <td>{settlement.driverName}</td>
      <td>{formatDate(settlement.checkDate)}</td>
      <td className="muted">
        {formatDate(settlement.periodStart)} – {formatDate(settlement.periodEnd)}
      </td>
      <td className="num">{settlement.loadCount}</td>
      <td className="num">{formatMiles(settlement.miles)}</td>
      <td className="num">{formatMoney(settlement.settlementTotal)}</td>
      {/* A settlement of nothing but flat pay has no miles to divide by, so
          the API sends null rather than Infinity. */}
      <td className="num">
        {settlement.perMile === null ? '—' : `$${settlement.perMile.toFixed(2)}`}
      </td>
    </tr>
  )
}
