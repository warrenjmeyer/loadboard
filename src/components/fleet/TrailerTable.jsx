import { Link } from 'react-router-dom'
import { statusSlug } from '../../lib/format.js'
import DueDate from './DueDate.jsx'

export default function TrailerTable({ trailers, onEdit = null }) {
  if (trailers.length === 0) return <p className="muted">No trailers.</p>

  return (
    <div className="table-scroll">
      <table className="loads fleet">
        <thead>
          <tr>
            <th>Trailer</th>
            <th>Type</th>
            <th>Description</th>
            <th>Plate</th>
            <th>Status</th>
            <th>On</th>
            <th>Registration</th>
            <th>Inspection</th>
            {onEdit && <th />}
          </tr>
        </thead>
        <tbody>
          {trailers.map((t) => (
            <tr key={t.trailerNo} className={t.status !== 'Active' ? 'row-off' : undefined}>
              <td className="mono">{t.trailerNo}</td>
              <td>{t.trailerType}</td>
              <td>{t.description}</td>
              <td className="mono nowrap">{t.plate ? `${t.plate}${t.plateState ? ` ${t.plateState}` : ''}` : ''}</td>
              <td><span className={`badge badge-${statusSlug(t.status)}`}>{t.status}</span></td>
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
                  <button type="button" className="linklike" onClick={() => onEdit(t.trailerNo)}>Edit</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
