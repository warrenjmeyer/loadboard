import { Link } from 'react-router-dom'
import { formatClock, clockClass, formatAge } from '../lib/hos.js'

// ---------------------------------------------------------------------------
// Every driver's hours of service, one row each, as dispatch sees them.
//
// The four clocks are the ones a dispatcher checks before saying "yes, take
// it": drive (11 h), shift (14 h on duty), workday, and cycle (70 h in 8
// days). The API sends seconds remaining and has already put the driver
// nearest to running out at the top, so the person dispatch cannot legally
// send anywhere is the first row, not the twelfth.
//
// A driver Geotab has never heard of is listed with dashes and says so. That
// is a roster problem -- the two names differ -- and hiding it would make it
// permanent.
// ---------------------------------------------------------------------------
function Status({ row }) {
  if (!row.matched) return <span className="muted small" title="No GeoTab user with this driver's name">not in GeoTab</span>
  if (!row.status) return <span className="muted">—</span>
  return (
    <>
      <span className={`badge badge-duty-${row.statusGroup.toLowerCase()}`}>{row.statusLabel}</span>
      {row.statusMinutes !== null && <span className="muted small"> {formatAge(row.statusMinutes)}</span>}
    </>
  )
}

function Clock({ seconds, hasAvailability }) {
  if (!hasAvailability) return <td className="num muted">—</td>
  return <td className={`num nowrap ${clockClass(seconds)}`}>{formatClock(seconds)}</td>
}

export default function HoursTable({ drivers }) {
  if (!drivers || drivers.length === 0) return <p className="muted">No drivers.</p>

  return (
    <div className="table-scroll">
      <table className="loads fleet hours">
        <thead>
          <tr>
            <th>Driver</th>
            <th>Unit</th>
            <th>Status</th>
            <th className="num">Drive</th>
            <th className="num">Shift</th>
            <th className="num">Cycle</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {drivers.map((d) => {
            const notes = []
            if (d.exemptions?.sixteenHour) notes.push('16-hour exemption available')
            if (d.exemptions?.adverseDriving) notes.push('adverse driving available')
            if (d.hasAvailability && d.rest !== null && d.rest > 0) notes.push(`${formatClock(d.rest)} to a 30-min break`)
            return (
              <tr key={d.driverCode} className={!d.matched ? 'row-off' : undefined}>
                <td className="mono">
                  <Link to={`/settlements/${encodeURIComponent(d.driverCode)}`} title={d.name}>{d.driverCode}</Link>
                  <span className="muted small"> {d.name}</span>
                </td>
                <td className="mono">{d.unitNo || ''}</td>
                <td className="nowrap"><Status row={d} /></td>
                <Clock seconds={d.driving} hasAvailability={d.hasAvailability} />
                <Clock seconds={d.duty} hasAvailability={d.hasAvailability} />
                <Clock seconds={d.cycle} hasAvailability={d.hasAvailability} />
                <td className="small muted">
                  {d.matched && !d.hasAvailability ? 'no HOS logs in GeoTab' : notes.join(' · ')}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
