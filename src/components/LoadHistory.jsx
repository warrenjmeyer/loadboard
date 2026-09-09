// ---------------------------------------------------------------------------
// What has happened to a load, oldest first.
//
// Presentational. The events come from GET /api/loads/{id}/events and are
// shown as the sentences the server wrote: "Assigned to JSMITH in Demo - 01",
// "Covered → In Transit". The page decides whether to fetch them at all --
// they name names, so an anonymous visitor never sees this component.
// ---------------------------------------------------------------------------

// The timestamp IS an instant (SYSUTCDATETIME on the server), so unlike an
// appointment it is correct to render it in the reader's own timezone.
const when = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
})

function describe(ev) {
  if (ev.type === 'Status' && ev.fromStatus && ev.toStatus) {
    return `${ev.fromStatus} → ${ev.toStatus}${ev.detail ? ` · ${ev.detail}` : ''}`
  }
  return ev.detail || ev.type
}

export default function LoadHistory({ events }) {
  if (!events || events.length === 0) {
    return <p className="muted">No history recorded for this load yet.</p>
  }

  return (
    <ol className="history">
      {events.map((ev) => (
        <li key={ev.id}>
          <span className="history-when">{when.format(new Date(ev.at))}</span>
          <span className="history-what">{describe(ev)}</span>
          {ev.actor && <span className="history-who muted">{ev.actor}</span>}
        </li>
      ))}
    </ol>
  )
}
