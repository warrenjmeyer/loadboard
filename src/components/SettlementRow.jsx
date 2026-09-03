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
      {/* The badge matters more than it looks. Two different documents are
          listed in one table, and the Total column means different things in
          each: a company driver's is gross pay with tax still to come out, an
          owner/operator's is the cheque less every cost of running the truck.
          Sorting the column and reading down it without knowing which is which
          is how someone concludes the contractors are underpaid. */}
      <td>
        {settlement.driverName}
        {settlement.driverType === 'OWNER' && (
          <span className="badge-oo" title="Owner/operator — 1099 contractor">
            O/O
          </span>
        )}
      </td>
      <td>{formatDate(settlement.checkDate)}</td>
      <td className="muted">
        {formatDate(settlement.periodStart)} – {formatDate(settlement.periodEnd)}
      </td>
      <td className="num">{settlement.loadCount}</td>
      <td className="num">{formatMiles(settlement.miles)}</td>
      <td className="num">{formatMoney(settlement.settlementTotal)}</td>
      {/* TWO REASONS THIS CELL SHOWS A DASH, and they are different reasons.

          A settlement of nothing but flat pay has no miles to divide by, so
          the API sends perMile as null rather than Infinity.

          An owner/operator's is dashed even though the API computed a real
          number, because the number is not the same KIND of thing as the one
          above it in the column. A company driver's $/mi is gross pay before
          payroll withholds tax. A contractor's would be what is left after
          they have paid for fuel, the truck, its insurance and the trailer --
          so $0.80 and $0.80 in adjacent rows can differ by a factor of three
          in what the driver actually earned per mile. The badge beside the
          name says the row is different; it does not stop a column of aligned
          decimals inviting the comparison.

          Declining to answer beats answering in a different currency. The
          value is still in the payload for anyone who wants it -- the API has
          no business deciding a figure is unshowable, and the board has no
          business showing one that reads as something it is not. */}
      <td className="num">
        {settlement.driverType === 'OWNER' ? (
          <span title="Not comparable: an owner/operator's settlement is net of fuel, truck, insurance and trailer costs.">
            —
          </span>
        ) : settlement.perMile === null ? (
          '—'
        ) : (
          `$${settlement.perMile.toFixed(2)}`
        )}
      </td>
    </tr>
  )
}
