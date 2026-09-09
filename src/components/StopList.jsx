import { formatWindow } from '../lib/format.js'

// ---------------------------------------------------------------------------
// A load's itinerary, in the order it is driven. Presentational: the stops
// come from GET /api/loads/{id}/stops, and the page decides whether to
// offer check-in buttons (onCheckIn) -- the server decides whether to
// honour them.
//
// An anonymous visitor's stops have their name, address and phone nulled by
// the API, so a stop with no name simply shows its place; nothing here
// knows who is reading.
//
// The instant a driver arrived or departed is shown in the reader's own
// time, like the history: it is a moment, not an appointment.
// ---------------------------------------------------------------------------
const when = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const at = (iso) => (iso ? when.format(new Date(`${iso}Z`)) : null)

export default function StopList({ stops, progress = null, onCheckIn = null, busy = false }) {
  if (!stops || stops.length === 0) return <p className="muted">No stops recorded for this load.</p>
  const currentId = progress?.current ? progress.current.stopId : null

  return (
    <ol className="stops">
      {stops.map((s) => {
        const state = s.departedUtc ? 'done' : s.arrivedUtc ? 'at-dock' : s.stopId === currentId ? 'next' : 'pending'
        return (
          <li key={s.stopId ?? s.seq} className={`stop stop-${state}`}>
            <div className="stop-seq mono">{s.seq}</div>
            <div className="stop-body">
              <div className="stop-head">
                <span className={`badge badge-${s.stopType === 'Pickup' ? 'available' : 'covered'}`}>{s.stopType}</span>
                <span className="stop-place">{s.place}</span>
                {s.referenceNo && <span className="mono muted small">ref {s.referenceNo}</span>}
              </div>
              {(s.name || s.address || s.phone) && (
                <div className="stop-dock">
                  {s.name && <span>{s.name}</span>}
                  {s.address && <span className="muted"> · {s.address}</span>}
                  {s.phone && <span className="muted"> · <a href={`tel:${s.phone}`}>{s.phone}</a></span>}
                </div>
              )}
              <div className="stop-when small">
                {formatWindow(s.windowStart, s.windowEnd)
                  ? <span>Window {formatWindow(s.windowStart, s.windowEnd)}</span>
                  : <span className="muted">No appointment</span>}
                {s.arrivedUtc && <span className="muted"> · arrived {at(s.arrivedUtc)}</span>}
                {s.departedUtc && <span className="muted"> · departed {at(s.departedUtc)}</span>}
              </div>
              {s.notes && <div className="stop-notes muted small">{s.notes}</div>}
              {onCheckIn && s.stopId === currentId && (
                <div className="stop-actions">
                  {!s.arrivedUtc
                    ? <button type="button" className="primary" disabled={busy} onClick={() => onCheckIn(s.stopId, 'arrive')}>Arrived</button>
                    : <button type="button" className="primary" disabled={busy} onClick={() => onCheckIn(s.stopId, 'depart')}>
                      {s.stopType === 'Pickup' ? 'Loaded, departing' : 'Unloaded, departing'}
                    </button>}
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
