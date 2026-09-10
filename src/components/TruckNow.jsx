import { formatAge, isStale, compass, geotabMapUrl, mapsUrl } from '../lib/hos.js'
import HoursClocks from './HoursClocks.jsx'

// ---------------------------------------------------------------------------
// The truck on a load, right now: where it is and how many hours its driver
// has. Drawn on the load page while the load is Covered or In Transit.
//
// Presentational. `position` is one row of /api/telematics/positions and
// `hours` one row of /api/telematics/hours; either may be null, and the
// page decides whether to ask for them at all (the driver's hours are not
// every reader's to see). `notConnected` means the server has no GeoTab
// credential, and the whole thing says so in one line and stops.
// ---------------------------------------------------------------------------
export default function TruckNow({ position, hours, database = null, notConnected = false, error = null }) {
  if (notConnected) {
    return <p className="muted small">GeoTab is not connected, so there is no live position for this truck.</p>
  }
  if (error) return <p className="error">Could not read from GeoTab: {error}</p>
  if (!position && !hours) return <p className="muted small">Asking GeoTab...</p>

  const stale = position ? (!position.reported || isStale(position.ageMinutes)) : true
  const maps = position ? mapsUrl(position.latitude, position.longitude) : null
  const geotab = position ? geotabMapUrl(database, position.geotabDeviceId) : null

  return (
    <div className="truck-now">
      {position && (
        <dl className="detail">
          <div>
            <dt>Truck</dt>
            <dd className="mono">
              {position.unitNo}
              {position.driver && position.driver.driverCode && (
                <span className="muted"> · {position.driver.driverCode} in the seat</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Moving</dt>
            <dd>
              {!position.reported ? <span className="muted">—</span>
                : position.isDriving && position.speedMph > 0
                  ? `${position.speedMph} mph${compass(position.bearing) ? ` heading ${compass(position.bearing)}` : ''}`
                  : position.isDriving ? 'Yes' : 'Stopped'}
            </dd>
          </div>
          <div>
            <dt>Last report</dt>
            <dd>
              {!position.geotabDeviceId ? <span className="muted">not in GeoTab</span>
                : !position.reported ? <span className="muted">never</span>
                : <span className={stale ? 'due-soon' : undefined}>{formatAge(position.ageMinutes)}</span>}
            </dd>
          </div>
          <div>
            <dt>Position</dt>
            <dd>
              {maps
                ? <a className={position.near ? undefined : 'mono'} href={maps} target="_blank" rel="noreferrer" title={`${position.latitude}, ${position.longitude}`}>
                  {position.near ? `near ${position.near}` : `${position.latitude}, ${position.longitude}`}
                </a>
                : <span className="muted">—</span>}
              {geotab && (
                <div className="addr"><a href={geotab} target="_blank" rel="noreferrer">Open in GeoTab map</a></div>
              )}
            </dd>
          </div>
        </dl>
      )}
      {hours && <HoursClocks hours={hours} compact />}
    </div>
  )
}
