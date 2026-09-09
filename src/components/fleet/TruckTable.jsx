import { Link } from 'react-router-dom'
import { statusSlug } from '../../lib/format.js'
import DueDate from './DueDate.jsx'

// ---------------------------------------------------------------------------
// The trucks, one row each. Presentational: rows in, markup out. Sorting and
// editing live in the page; this only knows how to draw a truck.
//
// onEdit(unitNo) is optional. Without it there is no Edit column, which is
// how a driver sees the page -- the same list, nothing to press.
// ---------------------------------------------------------------------------
export default function TruckTable({ trucks, onEdit = null }) {
  if (trucks.length === 0) return <p className="muted">No trucks.</p>

  return (
    <div className="table-scroll">
      <table className="loads fleet">
        <thead>
          <tr>
            <th>Unit</th>
            <th>Truck</th>
            <th>Plate</th>
            <th>Status</th>
            <th>Driver</th>
            <th>On</th>
            <th>Registration</th>
            <th>Inspection</th>
            {onEdit && <th />}
          </tr>
        </thead>
        <tbody>
          {trucks.map((t) => (
            <tr key={t.unitNo} className={t.status !== 'Active' ? 'row-off' : undefined}>
              <td className="mono">{t.unitNo}</td>
              <td>
                {t.description}
                {t.ownerType === 'OWNER' && (
                  <span className="badge badge-oo" title={`Owned by ${t.ownerDriverCode}`}>O/O</span>
                )}
              </td>
              <td className="mono nowrap">{t.plate ? `${t.plate}${t.plateState ? ` ${t.plateState}` : ''}` : ''}</td>
              <td><span className={`badge badge-${statusSlug(t.status)}`}>{t.status}</span></td>
              <td className="mono">
                {t.regularDriver ? (
                  <Link to={`/settlements/${encodeURIComponent(t.regularDriver.driverCode)}`} title={t.regularDriver.name}>
                    {t.regularDriver.driverCode}
                  </Link>
                ) : ''}
              </td>
              <td>
                {t.currentLoad ? (
                  <>
                    <Link className="mono" to={`/loads/${encodeURIComponent(t.currentLoad.id)}`}>{t.currentLoad.id}</Link>
                    <span className="muted"> → {t.currentLoad.destination}</span>
                  </>
                ) : <span className="muted">—</span>}
              </td>
              <td className="nowrap"><DueDate iso={t.registrationExpires} days={t.registrationDays} /></td>
              <td className="nowrap"><DueDate iso={t.inspectionDue} days={t.inspectionDays} /></td>
              {onEdit && (
                <td>
                  <button type="button" className="linklike" onClick={() => onEdit(t.unitNo)}>Edit</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
