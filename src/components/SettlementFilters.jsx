import { formatDate } from '../lib/format.js'

// ---------------------------------------------------------------------------
// The settlements equivalent of LoadFilters, and deliberately the same shape:
// a controlled component with no state of its own. Every value comes from
// props, every change reports back up.
//
// One difference worth noting. LoadFilters hardcodes its equipment list,
// because "Dry Van, Reefer, Flatbed" is fixed by the business. Pay dates are
// not -- a new one appears every week -- so they are passed in from whatever
// the data actually contains. Hardcoding those would mean editing this file
// every payroll run.
// ---------------------------------------------------------------------------
export default function SettlementFilters({
  search,
  payDate,
  payDates,
  withDeductionsOnly,
  onSearchChange,
  onPayDateChange,
  onWithDeductionsOnlyChange,
}) {
  return (
    <div className="filters">
      <label>
        Search
        <input
          type="text"
          value={search}
          placeholder="Driver or document #"
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </label>

      <label>
        Pay date
        <select value={payDate} onChange={(e) => onPayDateChange(e.target.value)}>
          <option value="All">All</option>
          {payDates.map((date) => (
            <option key={date} value={date}>
              {formatDate(date)}
            </option>
          ))}
        </select>
      </label>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={withDeductionsOnly}
          onChange={(e) => onWithDeductionsOnlyChange(e.target.checked)}
        />
        With deductions only
      </label>
    </div>
  )
}
