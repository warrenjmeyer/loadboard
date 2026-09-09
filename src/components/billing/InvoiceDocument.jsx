import { Link } from 'react-router-dom'
import { formatMoney, formatDate, formatMiles } from '../../lib/format.js'
import { COMPANY } from '../../lib/company.js'

// ---------------------------------------------------------------------------
// The invoice as a document: what gets printed to PDF and sent to the
// customer's AP department. Presentational, from the /api/invoices/{no}
// payload, and reusing the statement's masthead classes so the two
// documents the carrier sends out look like they came from one office.
//
// Lines are grouped by load: the line haul, then that load's charges
// indented under it, so a stop-off reads as part of the load it was on.
// A charge whose load was billed on an earlier invoice (a straggler) has
// no line haul here; it prints under its load number with a note, because
// the customer's AP will look for that number.
// ---------------------------------------------------------------------------
export default function InvoiceDocument({ invoice }) {
  const byLoad = new Map()
  for (const line of invoice.lines) {
    if (!byLoad.has(line.loadId)) byLoad.set(line.loadId, { loadId: line.loadId, linehaul: null, charges: [], deliveredDate: line.deliveredDate, referenceNo: line.referenceNo, miles: line.miles })
    const g = byLoad.get(line.loadId)
    if (line.lineType === 'LINEHAUL') g.linehaul = line
    else g.charges.push(line)
  }
  const groups = [...byLoad.values()]
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

      <div className="stmt-block stmt-driver">
        <div className="stmt-section-title">Bill to</div>
        <div>
          <strong>{invoice.billToName}</strong>
          {invoice.billToAddress && <div className="muted">{invoice.billToAddress}</div>}
          {invoice.customer?.contactName && <div className="muted small">Attn: {invoice.customer.contactName}</div>}
          {invoice.customer?.mcNumber && <div className="muted small">{invoice.customer.mcNumber}</div>}
        </div>
      </div>

      <div className="stmt-block">
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
          <tbody>
            {groups.map((g) => (
              <GroupRows key={g.loadId} group={g} />
            ))}
          </tbody>
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
    <>
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
    </>
  )
}
