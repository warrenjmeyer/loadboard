import { Link } from 'react-router-dom'
import { formatMoney, formatMiles, formatDate } from '../lib/format.js'

// One load's fields. Presentational: data in, markup out, no state and no
// fetching -- the same division as LoadTable against App, and it exists for the
// same practical reason. LoadDetail cannot be smoke-rendered in its interesting
// states, because reaching them means resolving a fetch; this can, from a
// literal object, which is what render.check.mjs does with it.
export default function LoadCard({ load }) {
  const rpm = load.rate / load.miles

  return (
    <>
      <header>
        <h1 className="mono">{load.id}</h1>
        <p className="sub">
          {load.origin} → {load.destination}
          {' · '}
          <span className={`badge badge-${load.status.toLowerCase()}`}>{load.status}</span>
        </p>
      </header>

      {/* A description list, not a table. One record with labelled fields is
          what <dl> is for, and it reads correctly to a screen reader without
          the row-and-column scaffolding a table implies. */}
      <dl className="detail">
        <div>
          <dt>Miles</dt>
          <dd>{formatMiles(load.miles)}</dd>
        </div>
        <div>
          <dt>Rate</dt>
          <dd>{formatMoney(load.rate)}</dd>
        </div>
        <div>
          <dt>$/mi</dt>
          <dd>{formatMoney(rpm)}</dd>
        </div>
        <div>
          <dt>Equipment</dt>
          <dd>{load.equipment}</dd>
        </div>
        <div>
          <dt>Driver</dt>
          <dd>
            {/* driverCode and deliveredDate are null together --
                CK_Loads_delivered guarantees it -- so one check covers the
                pair, and an anonymous visitor sees "Not delivered" because the
                API nulled the field, not because the load has no driver. */}
            {load.driverCode ? (
              <Link className="mono" to={`/settlements/${encodeURIComponent(load.driverCode)}`}>
                {load.driverCode}
              </Link>
            ) : (
              <span className="muted">Not delivered</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Delivered</dt>
          <dd>
            {load.deliveredDate ? formatDate(load.deliveredDate) : <span className="muted">—</span>}
          </dd>
        </div>
      </dl>

      <nav className="board-nav">
        <Link to="/">← Load board</Link>
        {load.driverCode && (
          <Link to={`/settlements/${encodeURIComponent(load.driverCode)}`}>
            Driver settlements
          </Link>
        )}
      </nav>
    </>
  )
}
