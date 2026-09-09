import LoadRow from './LoadRow.jsx'

// The columns, as data rather than as ten near-identical lines of markup.
//
// `key` is the field name sorting reads (see sortValue in sortLoads.js);
// `label` is what the person sees; `numeric` only picks the right-aligned CSS
// class. When the header and the sort key are written out separately in ten
// places, they drift -- one gets renamed and the column silently stops
// sorting.
const COLUMNS = [
  { key: 'id', label: 'Load #' },
  { key: 'origin', label: 'Origin' },
  { key: 'destination', label: 'Destination' },
  { key: 'pickupStart', label: 'Pickup' },
  { key: 'miles', label: 'Miles', numeric: true },
  { key: 'rate', label: 'Rate', numeric: true },
  { key: 'rpm', label: '$/mi', numeric: true },
  { key: 'equipment', label: 'Equipment' },
  { key: 'status', label: 'Status' },
  { key: 'driverCode', label: 'Driver' },
]

// onSort is optional. Without it the headers are plain text -- a page that
// shows a short, already-ordered list (a driver's delivered loads, newest
// first) has no use for sort buttons, and a button that does nothing is
// worse than no button.
export default function LoadTable({ loads, sortKey = null, sortDir = 'asc', onSort = null }) {
  // Early return for the empty case. Cleaner than nesting the whole table
  // inside a conditional.
  if (loads.length === 0) {
    return <p className="muted">No loads match those filters.</p>
  }

  return (
    <div className="table-scroll">
    <table className="loads">
      <thead>
        <tr>
          {COLUMNS.map((col) => {
            const active = sortKey === col.key

            return (
              // `key` here is React's own list bookkeeping and has nothing to
              // do with col.key being a sort key -- it just needs to be stable
              // and unique among siblings, and the column name is both.
              <th
                key={col.key}
                className={col.numeric ? 'num' : undefined}
                // aria-sort is how a screen reader announces "sorted by this
                // column, ascending". The arrow below is the same fact drawn
                // for people who can see it.
                aria-sort={onSort ? (active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
              >
                {onSort ? (
                  // A button, not a click handler on the <th>. A div or a cell
                  // that responds to clicks is invisible to the keyboard; a
                  // button is focusable, works on Enter and Space, and
                  // announces itself as something you can press. The styling
                  // makes it look like the header text it replaced.
                  <button type="button" className="sort" onClick={() => onSort(col.key)}>
                    {col.label}
                    <span className="arrow" aria-hidden="true">
                      {active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                    </span>
                  </button>
                ) : (
                  <span className="sort">{col.label}</span>
                )}
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {loads.map((load) => (
          <LoadRow key={load.id} load={load} />
        ))}
      </tbody>
    </table>
    </div>
  )
}
