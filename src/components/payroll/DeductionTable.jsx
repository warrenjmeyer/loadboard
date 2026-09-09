import { formatMoney, formatRate, formatDate } from '../../lib/format.js'

// ---------------------------------------------------------------------------
// One driver's standing deductions. Presentational; onEdit adds the column.
// ---------------------------------------------------------------------------
export default function DeductionTable({ deductions, onEdit = null }) {
  if (deductions.length === 0) return <p className="muted">No standing deductions for this driver.</p>

  return (
    <div className="table-scroll">
      <table className="loads deductions">
        <thead>
          <tr>
            <th>Code</th>
            <th>Description</th>
            <th className="num">Amount</th>
            <th>Kind</th>
            <th className="num">Owed</th>
            <th>From</th>
            <th>Until</th>
            <th>Status</th>
            {onEdit && <th />}
          </tr>
        </thead>
        <tbody>
          {deductions.map((d) => (
            <tr key={d.deductionId} className={d.active ? undefined : 'row-off'}>
              <td className="mono">{d.code}</td>
              <td>{d.description}</td>
              <td className="num nowrap">{d.basis === 'PER_MILE' ? `${formatRate(d.amount)}/mi` : formatMoney(d.amount)}</td>
              <td>
                {d.escrowCode ? `escrow · ${d.escrowCode}` : d.balance !== null ? 'loan' : d.basis === 'PER_MILE' ? 'per mile' : 'weekly'}
              </td>
              <td className="num">{d.balance !== null ? formatMoney(d.balance) : ''}</td>
              <td className="nowrap">{d.startDate ? formatDate(d.startDate) : ''}</td>
              <td className="nowrap">{d.endDate ? formatDate(d.endDate) : ''}</td>
              <td>
                <span className={`badge badge-${d.active ? 'active' : 'retired'}`}>{d.active ? 'Active' : 'Off'}</span>
              </td>
              {onEdit && (
                <td><button type="button" className="linklike" onClick={() => onEdit(d.deductionId)}>Edit</button></td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
