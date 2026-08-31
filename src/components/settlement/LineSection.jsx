import { formatMoney } from '../../lib/format.js'

// ---------------------------------------------------------------------------
// One block of money lines with a subtotal: revenue, per diem, reimbursements
// or deductions.
//
// The ColdFusion original repeated this markup four times and accumulated the
// running total inline with <cfset> as it rendered. Doing arithmetic during
// render is what makes those pages so hard to change -- move a section and the
// totals silently change. Here the caller passes a subtotal it already
// computed, and this component only draws.
//
// Renders nothing when there are no lines. A settlement with no deductions
// should not show an empty "Deductions" heading with a $0.00 under it.
// ---------------------------------------------------------------------------
export default function LineSection({ title, lines, subtotal }) {
  if (!lines.length) return null

  return (
    <div className="stmt-section">
      <div className="stmt-section-title">{title}</div>

      {lines.map((line, i) => (
        <div className="stmt-row" key={`${line.description}-${i}`}>
          <div className="stmt-order">{line.orderNo || ''}</div>
          <div className="stmt-desc">
            {line.description}
            {line.advanceReference && (
              <span className="muted"> — {line.advanceReference}</span>
            )}
          </div>
          <div className="stmt-amount">{formatMoney(line.amount)}</div>
        </div>
      ))}

      <div className="stmt-row stmt-subtotal">
        <div className="stmt-order" />
        <div className="stmt-desc" />
        <div className="stmt-amount">{formatMoney(subtotal)}</div>
      </div>
    </div>
  )
}
