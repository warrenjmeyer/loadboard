import { Link } from 'react-router-dom'
import { formatMoney, formatMiles, formatDate, formatWindow, formatWeight, statusSlug } from '../lib/format.js'
import { routeNameFor } from '../lib/geotab.js'
import StopList from './StopList.jsx'

// One load's fields. Presentational: data in, markup out, no state and no
// fetching -- the same division as LoadTable against App, and it exists for the
// same practical reason. LoadDetail cannot be smoke-rendered in its interesting
// states, because reaching them means resolving a fetch; this can, from a
// literal object, which is what render.check.mjs does with it.
//
// geotabUrl is passed in rather than computed here, and null means "do not
// show it". Whether the reader should see a link into MyGeotab is a question
// about who they are, and this component deliberately knows nothing about that
// -- the same reason it takes a load instead of fetching one.
//
// Sections that would be empty are not drawn. An anonymous visitor gets every
// party and contact nulled by the API, so "Customer and stops" disappears for
// them rather than showing six dashes -- and a load entered in a hurry with
// just the lane shows just the lane.
export default function LoadCard({ load, geotabUrl = null, stops = null, stopsProgress = null, onCheckIn = null, stopsBusy = false }) {
  const rpm = load.rate / load.miles

  // When the page hands in the itinerary, it is drawn in place of the
  // shipper and consignee rows: those two are the first and last stop, and
  // a three-stop load would otherwise show its middle nowhere.
  const hasStops = Array.isArray(stops) && stops.length > 0
  const hasParties = load.customerName || load.referenceNo || hasStops || load.shipperName
    || load.shipperAddress || load.consigneeName || load.consigneeAddress
  const hasFreight = load.commodity || load.weightLbs || load.pieces || load.hazmat || load.tempF != null

  const dash = <span className="muted">—</span>

  return (
    <>
      <header>
        <h1 className="mono">{load.id}</h1>
        <p className="sub">
          {load.origin} → {load.destination}
          {' · '}
          <span className={`badge badge-${statusSlug(load.status)}`}>{load.status}</span>
          {load.hazmat && <> {' · '}<span className="badge badge-hazmat">Hazmat</span></>}
        </p>
      </header>

      {/* A description list, not a table. One record with labelled fields is
          what <dl> is for, and it reads correctly to a screen reader without
          the row-and-column scaffolding a table implies. */}
      <dl className="detail">
        <div>
          <dt>Miles</dt>
          <dd>
            {formatMiles(load.miles)}
            {load.emptyMiles > 0 && <span className="muted small"> + {formatMiles(load.emptyMiles)} empty</span>}
          </dd>
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
          <dd>{load.equipment}{load.tempF !== null && load.tempF !== undefined ? ` · ${load.tempF}°F` : ''}</dd>
        </div>
        <div>
          <dt>Pickup</dt>
          <dd>{formatWindow(load.pickupStart, load.pickupEnd) || dash}</dd>
        </div>
        <div>
          <dt>Delivery</dt>
          <dd>{formatWindow(load.deliveryStart, load.deliveryEnd) || dash}</dd>
        </div>
        <div>
          <dt>Driver</dt>
          <dd>
            {/* An anonymous visitor sees a dash because the API nulled the
                field, not because the load has no driver. The wording stays
                neutral for that reason. */}
            {load.driverCode ? (
              <Link className="mono" to={`/settlements/${encodeURIComponent(load.driverCode)}`}>
                {load.driverCode}
              </Link>
            ) : (
              <span className="muted">{load.status === 'Available' ? 'Unassigned' : '—'}</span>
            )}
            {load.unitNo && <span className="muted"> · {load.unitNo}</span>}
            {load.trailerNo && <span className="muted"> · {load.trailerNo}</span>}
          </dd>
        </div>
        <div>
          <dt>Delivered</dt>
          <dd>{load.deliveredDate ? formatDate(load.deliveredDate) : dash}</dd>
        </div>
        {load.invoiceNo && (
          <div>
            <dt>Invoiced</dt>
            <dd><Link className="mono" to={`/invoices/${encodeURIComponent(load.invoiceNo)}`}>{load.invoiceNo}</Link></dd>
          </div>
        )}
        {geotabUrl && (
          <div>
            <dt>GeoTab route</dt>
            <dd>
              {/* A plain <a>, not a <Link>: this leaves the app entirely.
                  rel="noreferrer" so the load number this app is showing is
                  not handed to Geotab in a Referer header. */}
              <a href={geotabUrl} target="_blank" rel="noreferrer">
                {routeNameFor(load)}
              </a>
            </dd>
          </div>
        )}
      </dl>

      {hasParties && (
        <>
          <h2 className="section-title">Customer and stops</h2>
          <dl className="detail">
            <div>
              <dt>Customer</dt>
              <dd>
                {load.customerId
                  ? <Link to={`/customers/${load.customerId}`}>{load.customerName}</Link>
                  : (load.customerName || dash)}
                {load.customerStatus && load.customerStatus !== 'Active' && (
                  <> {' '}<span className={`badge badge-${load.customerStatus.toLowerCase()}`}>{load.customerStatus}</span></>
                )}
              </dd>
            </div>
            <div>
              <dt>Reference #</dt>
              <dd className="mono">{load.referenceNo || dash}</dd>
            </div>
            {!hasStops && (
              <>
                <div className="span-2">
                  <dt>Shipper</dt>
                  <dd>
                    {load.shipperName || dash}
                    {load.shipperAddress && <div className="addr">{load.shipperAddress}</div>}
                    {load.shipperPhone && <div className="addr"><a href={`tel:${load.shipperPhone}`}>{load.shipperPhone}</a></div>}
                  </dd>
                </div>
                <div className="span-2">
                  <dt>Consignee</dt>
                  <dd>
                    {load.consigneeName || dash}
                    {load.consigneeAddress && <div className="addr">{load.consigneeAddress}</div>}
                    {load.consigneePhone && <div className="addr"><a href={`tel:${load.consigneePhone}`}>{load.consigneePhone}</a></div>}
                  </dd>
                </div>
              </>
            )}
          </dl>
          {hasStops && <StopList stops={stops} progress={stopsProgress} onCheckIn={onCheckIn} busy={stopsBusy} />}
        </>
      )}

      {hasFreight && (
        <>
          <h2 className="section-title">Freight</h2>
          <dl className="detail">
            <div>
              <dt>Commodity</dt>
              <dd>{load.commodity || dash}</dd>
            </div>
            <div>
              <dt>Weight</dt>
              <dd>{formatWeight(load.weightLbs) || dash}</dd>
            </div>
            <div>
              <dt>Pieces</dt>
              <dd>{load.pieces ? formatMiles(load.pieces) : dash}</dd>
            </div>
            <div>
              <dt>Hazmat</dt>
              <dd>{load.hazmat ? 'Yes' : 'No'}</dd>
            </div>
          </dl>
        </>
      )}

      {load.notes && (
        <>
          <h2 className="section-title">Notes</h2>
          <p className="notes">{load.notes}</p>
        </>
      )}

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
