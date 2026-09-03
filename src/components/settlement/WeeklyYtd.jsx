import { formatMoney } from '../../lib/format.js'

// ---------------------------------------------------------------------------
// A block of money lines shown twice: this week, and year to date.
//
// This is the shape the whole owner/operator statement is built around, and it
// is the one thing the company statement has no equivalent of. A contractor is
// running a business. "You earned $1,145 this week" is not information they can
// act on; "$1,145 this week, $14,206 this year, against $9,880 of deductions"
// is. The original rendered this same three-column grid four times -- once as
// the summary, then again for compensation, reimbursements and deductions --
// which is why it is one component here.
//
// Both totals are passed in rather than summed from `lines`. The caller already
// has them from the API, and re-deriving a total in the component is how a
// subtotal ends up disagreeing with the summary that quotes it.
// ---------------------------------------------------------------------------
export default function WeeklyYtd({ title, lines, weekly, ytd, variant = 'section' }) {
  // A section with no lines is not drawn at all -- an empty "Reimbursements"
  // heading over a single $0.00 row tells nobody anything. The summary is the
  // exception: it is the point of the page, and it is passed no lines.
  if (variant === 'section' && !lines?.length) return null

  return (
    <div className={variant === 'summary' ? 'stmt-block stmt-wy-summary' : 'stmt-section'}>
      {variant === 'summary' ? <h2>{title}</h2> : <div className="stmt-section-title">{title}</div>}

      <div className="stmt-wy">
        <div className="stmt-row stmt-head">
          <div>Description</div>
          <div className="num">Weekly</div>
          <div className="num">Year to Date</div>
        </div>

        {lines?.map((line) => (
          <div className="stmt-row" key={line.description}>
            <div>{line.description}</div>
            <div className="num">{formatMoney(line.weekly)}</div>
            <div className="num">{formatMoney(line.ytd)}</div>
          </div>
        ))}

        <div className="stmt-row stmt-subtotal">
          <div>Total</div>
          <div className="num">{formatMoney(weekly)}</div>
          <div className="num">{formatMoney(ytd)}</div>
        </div>
      </div>
    </div>
  )
}
