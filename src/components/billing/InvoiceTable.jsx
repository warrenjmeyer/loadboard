import { Link } from 'react-router-dom'
import { formatMoney, formatDate } from '../../lib/format.js'

// ---------------------------------------------------------------------------
// Invoices, one row each, and the aging summary above them. Presentational.
//
// The list the API sends is already in the order accounts receivable reads
// it: open first, soonest due at the top, then paid, then void. Overdue
// rows are red on the days column, not the whole row -- the row is a fact,
// the lateness is the news.
// ---------------------------------------------------------------------------
const BUCKET_LABEL = { current: 'Current', '1-30': '1–30 days', '31-60': '31–60', '61-90': '61–90', '90+': 'Over 90' }

export function AgingSummary({ aging }) {
  if (!aging || aging.count === 0) return <p className="muted">Nothing outstanding.</p>
  return (
    <div className="aging">
      <div className="aging-cell aging-total">
        <div className="aging-value">{formatMoney(aging.total)}</div>
        <div className="aging-label">Outstanding · {aging.count} invoice{aging.count === 1 ? '' : 's'}</div>
      </div>
      {Object.entries(aging.buckets).map(([bucket, amount]) => (
        <div key={bucket} className={`aging-cell${amount > 0 && bucket !== 'current' ? ' aging-late' : ''}`}>
          <div className="aging-value">{amount > 0 ? formatMoney(amount) : <span className="muted">—</span>}</div>
          <div className="aging-label">{BUCKET_LABEL[bucket]}</div>
        </div>
      ))}
    </div>
  )
}

export default function InvoiceTable({ invoices, showCustomer = true }) {
  if (!invoices || invoices.length === 0) return <p className="muted">No invoices.</p>

  return (
    <div className="table-scroll">
      <table className="loads invoices">
        <thead>
          <tr>
            <th>Invoice</th>
            {showCustomer && <th>Customer</th>}
            <th>Dated</th>
            <th>Due</th>
            <th className="num">Loads</th>
            <th className="num">Total</th>
            <th className="num">Balance</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.invoiceNo} className={inv.status === 'Void' ? 'row-off' : undefined}>
              <td className="mono"><Link to={`/invoices/${encodeURIComponent(inv.invoiceNo)}`}>{inv.invoiceNo}</Link></td>
              {showCustomer && (
                <td>
                  <Link to={`/customers/${inv.customerId}`}>{inv.customerName}</Link>
                  {inv.customerStatus === 'Hold' && <span className="badge badge-hold">hold</span>}
                </td>
              )}
              <td className="nowrap">{formatDate(inv.invoiceDate)}</td>
              <td className="nowrap">
                {formatDate(inv.dueDate)}
                {inv.overdue && <span className="due-past small"> · {inv.daysPastDue} days late</span>}
              </td>
              <td className="num">{inv.loadCount}</td>
              <td className="num">{formatMoney(inv.total)}</td>
              <td className={`num${inv.overdue ? ' due-past' : ''}`}>{inv.status === 'Open' ? formatMoney(inv.balance) : <span className="muted">—</span>}</td>
              <td>
                <span className={`badge badge-inv-${inv.status.toLowerCase()}`}>{inv.status}</span>
                {inv.status === 'Paid' && inv.paidDate && <span className="muted small"> {formatDate(inv.paidDate)}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
