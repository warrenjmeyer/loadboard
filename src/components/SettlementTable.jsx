import SettlementRow from './SettlementRow.jsx'

export default function SettlementTable({ settlements }) {
  // Early return for the empty case, cleaner than nesting the whole table
  // inside a conditional.
  if (settlements.length === 0) {
    return <p className="muted">No settlements match those filters.</p>
  }

  return (
    <table className="loads">
      <thead>
        <tr>
          <th>Document</th>
          <th>Driver</th>
          <th>Pay date</th>
          <th>Period</th>
          <th className="num">Loads</th>
          <th className="num">Miles</th>
          <th className="num">Total</th>
          <th className="num">$/mi</th>
        </tr>
      </thead>
      <tbody>
        {settlements.map((s) => (
          // Neither the driver nor the date is unique on its own -- a driver
          // has several settlements and a pay date covers the whole fleet.
          // Together they are exactly the pair the database enforces as unique.
          <SettlementRow key={`${s.driverCode}-${s.checkDate}`} settlement={s} />
        ))}
      </tbody>
    </table>
  )
}
