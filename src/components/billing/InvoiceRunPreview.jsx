import { Link } from 'react-router-dom'
import { formatMoney, formatDate } from '../../lib/format.js'

// ---------------------------------------------------------------------------
// What an invoice run would create, one row per customer, each opening to
// the loads and charges behind it. Presentational, like PayrunPreview: the
// page owns which customers are ticked and what the button does.
//
// Two flags a billing clerk wants to see before pressing the button: the
// customer is on Hold (bill them anyway, but know it), and this invoice
// would take their open balance past the credit limit (a phone call before
// the next load, not a reason to withhold the invoice). A straggling charge
// -- one whose load was billed already -- is marked, because it will print
// under a load number the customer has seen before.
// ---------------------------------------------------------------------------
export default function InvoiceRunPreview({ plan, selected, onToggle }) {
  if (!plan.invoices.length) {
    return <p className="muted">Nothing to bill: no unbilled delivered loads on or before {formatDate(plan.through)}.</p>
  }

  return (
    <div className="table-scroll">
      <table className="loads payrun">
        <thead>
          <tr>
            <th />
            <th>Customer</th>
            <th>Due</th>
            <th className="num">Loads</th>
            <th className="num">Line haul</th>
            <th className="num">Extras</th>
            <th className="num">Total</th>
            <th className="num">Open now</th>
          </tr>
        </thead>
        <tbody>
          {plan.invoices.map((inv) => (
            <tr key={inv.customerId}>
              <td>
                <input
                  type="checkbox"
                  checked={selected.has(inv.customerId)}
                  onChange={() => onToggle(inv.customerId)}
                  aria-label={`Include ${inv.name}`}
                />
              </td>
              <td>
                <details>
                  <summary>
                    <Link to={`/customers/${inv.customerId}`}>{inv.name}</Link>
                    <span className="muted small"> net {inv.termsDays}</span>
                    {inv.onHold && <span className="badge badge-hold">on hold</span>}
                    {inv.overCredit && <span className="badge badge-in-transit">over credit limit</span>}
                    {inv.stragglers > 0 && <span className="badge badge-covered">{inv.stragglers} on billed loads</span>}
                  </summary>
                  <table className="payrun-loads">
                    <tbody>
                      {inv.loads.map((l) => (
                        <tr key={l.id}>
                          <td className="mono"><Link to={`/loads/${encodeURIComponent(l.id)}`}>{l.id}</Link></td>
                          <td>{l.lane}{l.referenceNo ? <span className="muted"> · ref {l.referenceNo}</span> : null}</td>
                          <td className="nowrap">{formatDate(l.deliveredDate)}</td>
                          <td className="num">{formatMoney(l.amount)}</td>
                        </tr>
                      ))}
                      {inv.charges.map((c) => (
                        <tr key={c.chargeId} className={`payrun-line${c.straggler ? ' due-soon' : ''}`}>
                          <td className="mono"><Link to={`/loads/${encodeURIComponent(c.loadId)}`}>{c.loadId}</Link></td>
                          <td colSpan={2}>{c.description}{c.straggler ? ' · load billed earlier' : ''}</td>
                          <td className="num">{formatMoney(c.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </td>
              <td className="nowrap">{formatDate(inv.dueDate)}</td>
              <td className="num">{inv.loads.length}</td>
              <td className="num">{formatMoney(inv.linehaul)}</td>
              <td className="num">{inv.extras ? formatMoney(inv.extras) : <span className="muted">—</span>}</td>
              <td className="num"><strong>{formatMoney(inv.total)}</strong></td>
              <td className={`num${inv.overCredit ? ' due-past' : ''}`}>
                {inv.openBalance ? formatMoney(inv.openBalance) : <span className="muted">—</span>}
                {inv.creditLimit !== null && <span className="muted small"> / {formatMoney(inv.creditLimit)}</span>}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td />
            <td>{plan.totals.customers} customer{plan.totals.customers === 1 ? '' : 's'}</td>
            <td />
            <td className="num">{plan.totals.loads}</td>
            <td className="num">{formatMoney(plan.totals.linehaul)}</td>
            <td className="num">{plan.totals.extras ? formatMoney(plan.totals.extras) : ''}</td>
            <td className="num">{formatMoney(plan.totals.total)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
