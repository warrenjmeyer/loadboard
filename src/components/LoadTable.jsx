import LoadRow from './LoadRow.jsx'

export default function LoadTable({ loads }) {
  // Early return for the empty case. Cleaner than nesting the whole table
  // inside a conditional.
  if (loads.length === 0) {
    return <p className="muted">No loads match those filters.</p>
  }

  return (
    <table className="loads">
      <thead>
        <tr>
          <th>Load #</th>
          <th>Origin</th>
          <th>Destination</th>
          <th className="num">Miles</th>
          <th className="num">Rate</th>
          <th className="num">$/mi</th>
          <th>Equipment</th>
          <th>Status</th>
          <th>Driver</th>
        </tr>
      </thead>
      <tbody>
        {loads.map((load) => (
          <LoadRow key={load.id} load={load} />
        ))}
      </tbody>
    </table>
  )
}
