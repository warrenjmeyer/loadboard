import { Link } from 'react-router-dom'
import { formatAge, isStale, compass, geotabMapUrl, mapsUrl } from '../../lib/hos.js'

// ---------------------------------------------------------------------------
// Where every truck is, one row each. Presentational: the rows come from
// GET /api/telematics/positions and this only knows how to draw them.
//
// Two facts about a truck can disagree and both are shown: who normally
// drives it (the app's Drivers.unit_no) and who Geotab says is in the seat
// (a DriverChange record, written by the Drive app). When they differ the
// seat wins the Driver column and the regular name goes in a title, because
// the seat is what is true right now.
//
// A report is "stale" after two hours (lib/hos.js). The row is not hidden;
// it is greyed and dated, because "last seen Tuesday in Des Moines" is still
// the best answer anyone has.
// ---------------------------------------------------------------------------
export default function PositionTable({ trucks, database = null }) {
  if (!trucks || trucks.length === 0) return <p className="muted">No trucks.</p>

  return (
    <div className="table-scroll">
      <table className="loads fleet positions">
        <thead>
          <tr>
            <th>Unit</th>
            <th>Driver</th>
            <th>On</th>
            <th>Moving</th>
            <th>Last report</th>
            <th>Position</th>
          </tr>
        </thead>
        <tbody>
          {trucks.map((t) => {
            const stale = !t.reported || isStale(t.ageMinutes)
            const seat = t.driver
            const regular = t.regularDriver
            const differs = seat && regular && seat.driverCode && seat.driverCode !== regular.driverCode
            const geotab = geotabMapUrl(database, t.geotabDeviceId)
            const maps = mapsUrl(t.latitude, t.longitude)
            return (
              <tr key={t.unitNo} className={stale ? 'row-off' : undefined}>
                <td className="mono">{t.unitNo}</td>
                <td className="mono">
                  {seat ? (
                    seat.driverCode ? (
                      <Link to={`/settlements/${encodeURIComponent(seat.driverCode)}`} title={differs ? `${seat.name} — regular driver is ${regular.driverCode}` : seat.name}>
                        {seat.driverCode}
                      </Link>
                    ) : (
                      <span title="In GeoTab but not on the roster">{seat.name || '?'}</span>
                    )
                  ) : regular ? (
                    <span className="muted" title={`${regular.name} — regular driver; nobody logged in`}>{regular.driverCode}</span>
                  ) : ''}
                  {differs && <span className="badge badge-swap" title="Not the regular driver">swap</span>}
                </td>
                <td>
                  {t.currentLoad ? (
                    <>
                      <Link className="mono" to={`/loads/${encodeURIComponent(t.currentLoad.id)}`}>{t.currentLoad.id}</Link>
                      <span className="muted"> → {t.currentLoad.destination}</span>
                    </>
                  ) : <span className="muted">—</span>}
                </td>
                <td className="nowrap">
                  {!t.reported ? <span className="muted">—</span>
                    : t.isDriving && t.speedMph > 0 ? `${t.speedMph} mph${compass(t.bearing) ? ` ${compass(t.bearing)}` : ''}`
                    : t.isDriving ? 'Yes'
                    : 'Stopped'}
                </td>
                <td className="nowrap">
                  {!t.geotabDeviceId ? <span className="muted" title="No vehicle with this unit number in GeoTab">not in GeoTab</span>
                    : !t.reported ? <span className="muted">never</span>
                    : <span className={stale ? 'due-soon' : undefined}>{formatAge(t.ageMinutes)}</span>}
                  {t.reported && !t.communicating && <span className="muted small"> · offline</span>}
                </td>
                <td className="nowrap">
                  {/* The town from GeoTab's reverse geocoding when it
                      answered; the coordinates are the link either way,
                      because "near Ankeny" is where to look and the
                      numbers are where it is. */}
                  {maps && (
                    <a className={t.near ? undefined : 'mono small'} href={maps} target="_blank" rel="noreferrer" title={`${t.latitude}, ${t.longitude}`}>
                      {t.near || `${t.latitude}, ${t.longitude}`}
                    </a>
                  )}
                  {maps && geotab && <span className="muted"> · </span>}
                  {geotab && <a className="small" href={geotab} target="_blank" rel="noreferrer">GeoTab map</a>}
                  {!maps && !geotab && <span className="muted">—</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
