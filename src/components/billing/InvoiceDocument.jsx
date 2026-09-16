import { Link } from 'react-router-dom'
import { formatMoney, formatDate, formatMiles } from '../../lib/format.js'
import { groupInvoice, loadsWithPod } from '../../lib/invoicePaper.js'
import { COMPANY } from '../../lib/company.js'

// ---------------------------------------------------------------------------
// The invoice as a document: what gets printed to PDF and sent to the
// customer's AP department. Presentational, from the /api/invoices/{no}
// payload, and reusing the statement's masthead classes so the two
// documents the carrier sends out look like they came from one office.
//
// Lines are grouped by load: the line haul, then that load's docks, then
// that load's charges indented under it, so a stop-off reads as part of the
// load it was on. A charge whose load was billed on an earlier invoice (a
// straggler) has no line haul here; it prints under its load number with a
// note, because the customer's AP will look for that number.
//
// The dock lines are what makes this payable. AP matches an invoice against
// a purchase order, and on a multi-stop load each consignee raised their
// own -- so each stop prints ITS reference number, not the one summary
// number on the load. Where the signed proof of delivery is already on
// file, the dock that signed it is marked, and a line under the totals
// names the loads it covers: "where is the POD" is the commonest reason a
// correct invoice sits unpaid for a month.
//
// Each load is its own <tbody> so that printing keeps a load with its docks
// and charges rather than breaking the group across two pages.
// ---------------------------------------------------------------------------
export default function InvoiceDocument({ invoice }) {
  const groups = groupInvoice(invoice)
  const withPod = loadsWithPod(groups)
  const balance = Math.round((invoice.total - invoice.paidAmount) * 100) / 100

  return (
    <div className="stmt invoice-doc">
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
          <div className="stmt-meta-title">Invoice</div>
          <div><span>Invoice #</span> <span className="mono">{invoice.invoiceNo}</span></div>
          <div><span>Invoice date</span> {formatDate(invoice.invoiceDate)}</div>
          <div><span>Terms</span> Net {invoice.termsDays}</div>
          <div><span>Due</span> {formatDate(invoice.dueDate)}</div>
          <div className="stmt-netpay">
            <span>{invoice.status === 'Paid' ? 'Paid in full' : invoice.status === 'Void' ? 'VOID' : 'Amount due'}</span>
            {' '}{invoice.status === 'Open' ? formatMoney(balance) : formatMoney(invoice.total)}
          </div>
        </div>
      </div>

      <div className="stmt-block invoice-billto">
        <div className="stmt-section-title">Bill to</div>
        <div>
          <strong>{invoice.billToName}</strong>
          {invoice.billToAddress && <div className="muted">{invoice.billToAddress}</div>}
          {invoice.customer?.contactName && <div className="muted small">Attn: {invoice.customer.contactName}</div>}
          {invoice.customer?.mcNumber && <div className="muted small">{invoice.customer.mcNumber}</div>}
        </div>
      </div>

      <div className="stmt-block invoice-block">
        <table className="stmt-table invoice-lines">
          <thead className="stmt-head">
            <tr>
              <th>Load</th>
              <th>Delivered</th>
              <th>Description</th>
              <th>Ref #</th>
              <th className="num">Miles</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          {groups.map((g) => (
            <GroupRows key={g.loadId} group={g} />
          ))}
          <tfoot>
            <tr className="stmt-subtotal">
              <td colSpan={5}>Total</td>
              <td className="num stmt-amount">{formatMoney(invoice.total)}</td>
            </tr>
            {invoice.paidAmount > 0 && (
              <>
                <tr>
                  <td colSpan={5}>Paid{invoice.paidDate ? ` ${formatDate(invoice.paidDate)}` : ''}</td>
                  <td className="num stmt-amount">{formatMoney(-invoice.paidAmount)}</td>
                </tr>
                <tr className="stmt-subtotal">
                  <td colSpan={5}>Balance due</td>
                  <td className="num stmt-amount">{formatMoney(balance)}</td>
                </tr>
              </>
            )}
          </tfoot>
        </table>
      </div>

      {withPod.length > 0 && (
        <p className="stmt-note small">
          Signed proof of delivery attached for{' '}
          <span className="mono">{withPod.join(', ')}</span>.
        </p>
      )}

      {invoice.notes && <p className="stmt-note">{invoice.notes}</p>}
      <p className="stmt-note muted small">
        Please remit to {COMPANY.name}, {COMPANY.address}, {COMPANY.city}, {COMPANY.state} {COMPANY.postalCode}, and reference the invoice number.
      </p>
    </div>
  )
}

function GroupRows({ group }) {
  const g = group
  return (
    <tbody className="invoice-group">
      {g.linehaul ? (
        <tr className="stmt-row">
          <td className="mono"><Link to={`/loads/${encodeURIComponent(g.loadId)}`}>{g.loadId}</Link></td>
          <td className="nowrap">{formatDate(g.deliveredDate)}</td>
          <td>{g.linehaul.description}</td>
          <td className="mono">{g.referenceNo || ''}</td>
          <td className="num">{g.miles ? formatMiles(g.miles) : ''}</td>
          <td className="num stmt-amount">{formatMoney(g.linehaul.amount)}</td>
        </tr>
      ) : (
        <tr className="stmt-row">
          <td className="mono"><Link to={`/loads/${encodeURIComponent(g.loadId)}`}>{g.loadId}</Link></td>
          <td className="nowrap">{formatDate(g.deliveredDate)}</td>
          <td className="muted">Load billed on an earlier invoice</td>
          <td className="mono">{g.referenceNo || ''}</td>
          <td />
          <td />
        </tr>
      )}

      {g.showStops && g.stops.map((s) => (
        <tr key={s.stopId ?? `${g.loadId}-${s.seq}`} className="stmt-row invoice-stop">
          <td />
          <td />
          <td className="stmt-route">
            <span className="mono muted small">{s.seq}</span>{' '}
            {s.stopType}
            {' · '}{s.place}
            {s.name && <span className="muted"> — {s.name}</span>}
            {s.pod && <span className="pod-mark"> POD</span>}
          </td>
          <td className="mono">{s.referenceNo || ''}</td>
          <td />
          <td />
        </tr>
      ))}

      {g.charges.map((c) => (
        <tr key={c.lineId} className="stmt-row invoice-charge">
          <td />
          <td />
          <td className="stmt-route">{c.description}</td>
          <td />
          <td />
          <td className="num stmt-amount">{formatMoney(c.amount)}</td>
        </tr>
      ))}
    </tbody>
  )
}
