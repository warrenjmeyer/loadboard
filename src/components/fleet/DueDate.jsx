import { formatDate } from '../../lib/format.js'

// A date that something is due, coloured by how soon. `days` comes from the
// server, computed against its clock, so a phone with the wrong date does not
// decide whether a plate has expired.
//
//   past       red, "expired"
//   ≤ 30 days  amber, "in N days"
//   otherwise  plain
export default function DueDate({ iso, days }) {
  if (!iso) return <span className="muted">—</span>
  if (days === null || days === undefined) return <>{formatDate(iso)}</>
  if (days < 0) {
    return <span className="due due-past" title={`${-days} days ago`}>{formatDate(iso)} · expired</span>
  }
  if (days <= 30) {
    return <span className="due due-soon">{formatDate(iso)} · {days === 0 ? 'today' : `${days}d`}</span>
  }
  return <>{formatDate(iso)}</>
}
