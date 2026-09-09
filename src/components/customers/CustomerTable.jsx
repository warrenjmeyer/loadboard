import { Link } from 'react-router-dom'
import { formatMoney, formatDate, statusSlug } from '../../lib/format.js'

// ---------------------------------------------------------------------------
// Every customer, one row each. Presentational. The name is the way in to
// the customer's page; onEdit, when given, adds an Edit column.
// ---------------------------------------------------------------------------
export default function CustomerTable({ customers, onEdit = null }) {
  if (customers.length === 0) return <p className="muted">No customers.</p>

  return (
    <div className="table-scroll">
      <table className="loads customers">
        <thead>
          <tr>
            <th>Customer</th>
            <th>Type</th>
            <th>Contact</th>
            <th>Terms</th>
            <th>Status</th>
            <th className="num">On board</th>
            <th className="num">Delivered</th>
            <th className="num">Billed</th>
            <th>Last</th>
            {onEdit && <th />}
          </tr>
        </thead>
        <tbody>
          {customers.map((c) => (
            <tr key={c.customerId} className={c.status !== 'Active' ? 'row-off' : undefined}>
              <td>
                <Link to={`/customers/${c.customerId}`}>{c.name}</Link>
                {c.mcNumber && <div className="muted mono small">{c.mcNumber}</div>}
              </td>
              <td>{c.customerType}</td>
              <td>
                {c.contactName}
                {c.phone && <div className="small"><a href={`tel:${c.phone}`}>{c.phone}</a></div>}
              </td>
              <td className="nowrap">Net {c.paymentTermsDays}</td>
              <td><span className={`badge badge-${statusSlug(c.status)}`}>{c.status}</span></td>
              <td className="num">{c.currentLoads || ''}</td>
              <td className="num">{c.deliveredLoads || ''}</td>
              <td className="num">{c.deliveredRevenue ? formatMoney(c.deliveredRevenue) : ''}</td>
              <td className="nowrap">{c.lastDelivered ? formatDate(c.lastDelivered) : ''}</td>
              {onEdit && (
                <td><button type="button" className="linklike" onClick={() => onEdit(c.customerId)}>Edit</button></td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
