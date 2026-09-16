import { formatDateTime, formatMiles, formatDuration } from '../lib/format.js'

// ---------------------------------------------------------------------------
// When this load gets to each stop it has left, and whether that is late.
//
// The numbers come from GET /api/loads/{id}/eta, which is a truck route from
// HERE measured from where GeoTab last saw the truck. Three things this
// component is careful to say out loud, because an ETA reads as a fact and
// it is a forecast:
//
//   TO THE TOWN, NOT THE DOCK. The coordinates are GeoTab zone centres, the
//   same places the map plots. The last few minutes across town are not in
//   the number, and neither is the time spent waiting at the gate.
//
//   AS OF WHEN. Traffic is in the route, which means the answer is only as
//   good as the moment it was asked, and the page says that moment.
//
//   TRUCK OR CAR. If the account is not entitled to truck routing the API
//   falls back to a car route rather than failing, and then this says so in
//   as many words: car times mean no bridge heights and no weight limits,
//   which on some lanes is an hour of difference and a bridge the trailer
//   cannot pass under.
//
// A refusal is not an error. The server answers `available: false` with a
// sentence for the cases where an ETA would be meaningless -- the load is
// not moving, the truck is 1,500 miles away, GeoTab has no zone for a stop.
// On the load page that sentence is shown; in a driver's card it is not,
// because a card is not the place to explain something nobody asked for.
// ---------------------------------------------------------------------------
export default function EtaPanel({
  eta = null,
  loading = false,
  notConnected = false,
  error = null,
  compact = false,
}) {
  if (notConnected) {
    return compact ? null : <p className="muted small">Routing is not connected, so there is no ETA for this load.</p>
  }
  if (error) {
    return compact ? null : <p className="error">Could not work out an ETA: {error}</p>
  }
  if (loading && !eta) {
    return compact ? null : <p className="muted small">Working out a road route...</p>
  }
  if (!eta) return null

  if (!eta.available) {
    if (compact) return null
    return (
      <p className="muted small">
        {eta.message}
        {eta.near && <> {eta.unitNo} last reported near {eta.near}.</>}
      </p>
    )
  }

  const { legs, next } = eta
  if (!legs || legs.length === 0) return null

  // A driver's card answers one question: when do I get to the next place.
  if (compact) {
    return (
      <p className="eta-compact">
        <span className="muted">Next stop</span> {next.place}
        {' '}<strong>{formatDateTime(next.eta)}</strong>{' '}
        <Timing timing={next.timing} />
      </p>
    )
  }

  return (
    <div className="eta">
      {/* Built as expressions rather than as text with holes in it: JSX turns
          the newline before a {...} into a space, which puts one in front of
          the comma. */}
      <p className="muted small eta-from">
        {`A ${eta.mode === 'truck' ? 'truck' : 'car'} route from where ${eta.unitNo} is now`}
        {eta.from && eta.from.near ? `, near ${eta.from.near}` : ''}
        {`: ${formatMiles(eta.totalMiles)} miles, ${formatDuration(eta.totalSeconds)} of driving.`}
      </p>

      {eta.hours && eta.hours.scheduled && eta.totalRestSeconds > 0 && (
        exhausted(eta.hours) ? (
          // The case this demo fleet is always in, and a real fleet is
          // sometimes in. Saying "0m of driving left" on its own reads like
          // a fault; naming the cycle says which clock ran out and why the
          // arrival is tomorrow.
          <p className="muted small eta-from">
            {`GeoTab shows this driver out of hours — nothing left on the ${cycleName(eta.hours)}. `}
            {`These times include the ${formatDuration(eta.totalRestSeconds)} reset that requires, `}
            {`which is why the arrival is later than the driving.`}
          </p>
        ) : (
          <p className="muted small eta-from">
            {`These times include ${formatDuration(eta.totalRestSeconds)} of legally required rest: `}
            {`the driver has ${formatDuration(Math.max(0, eta.hours.driving || 0))} of driving left before they must stop.`}
          </p>
        )
      )}

      {eta.hours && !eta.hours.scheduled && (
        <p className="warn small">
          GeoTab has no hours-of-service record for this driver, so these are driving
          times with no rest in them. A real arrival is later than this whenever the
          run is longer than the hours they have left.
        </p>
      )}

      {!eta.hours && (
        <p className="warn small">
          No driver hours were available, so these are driving times with no rest in
          them — not arrival times for a driver who has to sleep.
        </p>
      )}

      {eta.mode !== 'truck' && (
        <p className="warn small">
          These are CAR times. This account is not entitled to truck routing, so bridge
          heights, weight limits and truck-legal roads are not in them.
        </p>
      )}

      <table className="loads eta-table">
        <thead>
          <tr>
            <th>Stop</th>
            <th>ETA</th>
            <th>Window</th>
            <th className="num">Miles</th>
            <th className="num">Driving</th>
            <th>Rest</th>
          </tr>
        </thead>
        <tbody>
          {legs.map((leg) => (
            <tr key={leg.stopId}>
              <td>
                <span className="eta-seq">{leg.seq}</span> {leg.place}
                {leg.dock && <div className="muted small">{leg.dock}</div>}
              </td>
              <td>
                <strong>{formatDateTime(leg.eta)}</strong>
                <div><Timing timing={leg.timing} /></div>
              </td>
              <td className="muted small">
                {leg.windowStart || leg.windowEnd
                  ? <>{formatDateTime(leg.windowStart)}{leg.windowEnd ? ` – ${formatDateTime(leg.windowEnd)}` : ''}</>
                  : 'none given'}
              </td>
              <td className="num">{formatMiles(leg.miles)}</td>
              <td className="num">{formatDuration(leg.driveSeconds)}</td>
              <td className="eta-rest">
                {leg.restSeconds
                  ? <>{formatDuration(leg.restSeconds)} off{leg.rests > 1 ? ` (${leg.rests})` : ''}</>
                  : <span className="muted">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="muted small eta-note">
        To the town, not the dock — the last few minutes across town and the wait at the
        gate are not in these times, and the traffic in them is the traffic at the moment
        this was worked out.
        {/* Deliberately no clock on that moment: askedAt is UTC, every other
            time on this page is local to a dock, and one figure in the wrong
            frame next to the others is worse than no figure. */}
        {eta.partial && <> HERE answered for fewer legs than this load has stops, so the last stops are missing.</>}
      </p>
    </div>
  )
}

// Out of hours, and which clock did it. A driver can be stopped by the
// eleven-hour driving limit, the fourteen-hour window, or the seventy-hour
// cycle, and they mean different things to whoever has to cover the load:
// the first two clear overnight and the last one does not.
function exhausted(hours) {
  if (!hours) return false
  return [hours.driving, hours.duty, hours.cycle]
    .some((v) => v !== null && v !== undefined && Number(v) <= 0)
}

function cycleName(hours) {
  if (hours.cycle !== null && hours.cycle !== undefined && Number(hours.cycle) <= 0) return '70-hour cycle'
  if (hours.duty !== null && hours.duty !== undefined && Number(hours.duty) <= 0) return '14-hour window'
  return '11-hour driving clock'
}

// Late is the one a dispatcher is looking for, so it is the one with a
// colour. Early is worth knowing and not worth shouting about; inside the
// window is the ordinary case and says so quietly.
function Timing({ timing }) {
  if (!timing) return null
  if (timing.state === 'late') {
    return <span className="eta-late">{formatDuration(timing.minutes * 60)} late</span>
  }
  if (timing.state === 'early') {
    return <span className="eta-early">{formatDuration(timing.minutes * 60)} early</span>
  }
  if (timing.state === 'inWindow') return <span className="eta-ok">in the window</span>
  if (timing.state === 'no-window') return <span className="muted small">no window given</span>
  return null
}
