import { formatMoney, formatDate, statusSlug } from '../../lib/format.js'

// One customer's header and facts. Presentational, so render.check can draw
// it from a literal.
export default function CustomerCard({ customer: c }) {
  const dash = <span className="muted">—</span>
  const address = [c.address1, [c.city, c.state].filter(Boolean).join(', '), c.postalCode].filter(Boolean).join(' · ')

  return (
    <>
      <header>
        <h1>{c.name}</h1>
        <p className="sub">
          {c.customerType}
          {c.mcNumber && <> · <span className="mono">{c.mcNumber}</span></>}
          {' · '}
          <span className={`badge badge-${statusSlug(c.status)}`}>{c.status}</span>
        </p>
      </header>

      {c.status === 'Hold' && (
        <div className="error">
          On hold: loads for this customer cannot be covered until the hold is lifted.
          {c.notes ? ` ${c.notes}` : ''}
        </div>
      )}

      <dl className="detail">
        <div>
          <dt>Contact</dt>
          <dd>
            {c.contactName || dash}
            {c.phone && <div className="addr"><a href={`tel:${c.phone}`}>{c.phone}</a></div>}
            {c.email && <div className="addr"><a href={`mailto:${c.email}`}>{c.email}</a></div>}
          </dd>
        </div>
        <div className="span-2">
          <dt>Address</dt>
          <dd>{address || dash}</dd>
        </div>
        <div>
          <dt>Terms</dt>
          <dd>Net {c.paymentTermsDays}</dd>
        </div>
        <div>
          <dt>Credit limit</dt>
          <dd>{c.creditLimit === null ? <span className="muted">not set</span> : formatMoney(c.creditLimit)}</dd>
        </div>
        <div>
          <dt>Open</dt>
          <dd>{formatMoney(c.openRevenue)}<span className="muted small"> committed, not delivered</span></dd>
        </div>
        <div>
          <dt>Delivered</dt>
          <dd>{formatMoney(c.deliveredRevenue)}<span className="muted small"> on {c.deliveredLoads} loads</span></dd>
        </div>
        <div>
          <dt>Last delivered</dt>
          <dd>{c.lastDelivered ? formatDate(c.lastDelivered) : dash}</dd>
        </div>
      </dl>

      {c.notes && c.status !== 'Hold' && (
        <>
          <h2 className="section-title">Notes</h2>
          <p className="notes">{c.notes}</p>
        </>
      )}
    </>
  )
}
