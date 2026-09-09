import { formatClock, clockClass, formatAge } from '../lib/hos.js'

// ---------------------------------------------------------------------------
// One driver's clocks, large, for the driver's own page and the load page.
//
// Same numbers as a row of HoursTable, drawn for one person rather than
// twenty-four. A driver in a cab wants to know one thing -- how long can I
// keep going -- so drive time comes first and biggest.
// ---------------------------------------------------------------------------
export default function HoursClocks({ hours, compact = false }) {
  if (!hours) return null

  if (!hours.matched) {
    return <p className="muted small">GeoTab has no driver named {hours.name}, so there are no hours to show.</p>
  }
  if (!hours.hasAvailability) {
    return <p className="muted small">GeoTab has no hours-of-service logs for {hours.name} yet.</p>
  }

  const clocks = [
    ['Drive', hours.driving],
    ['Shift', hours.duty],
    ['Cycle', hours.cycle],
  ]
  if (!compact) clocks.push(['Break in', hours.rest])

  return (
    <div className={`clocks${compact ? ' clocks-compact' : ''}`}>
      {hours.status && (
        <div className="clock clock-status">
          <span className={`badge badge-duty-${hours.statusGroup.toLowerCase()}`}>{hours.statusLabel}</span>
          {hours.statusMinutes !== null && <div className="muted small">since {formatAge(hours.statusMinutes).replace(' ago', '')} ago</div>}
        </div>
      )}
      {clocks.map(([label, seconds]) => (
        <div key={label} className={`clock ${clockClass(seconds)}`}>
          <div className="clock-value">{formatClock(seconds)}</div>
          <div className="clock-label">{label}</div>
        </div>
      ))}
      {(hours.exemptions?.sixteenHour || hours.exemptions?.adverseDriving) && (
        <div className="clock clock-note muted small">
          {[hours.exemptions.sixteenHour && '16-hour exemption available', hours.exemptions.adverseDriving && 'adverse driving available']
            .filter(Boolean).join(' · ')}
        </div>
      )}
    </div>
  )
}
