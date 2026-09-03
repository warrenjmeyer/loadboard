import { formatMoney } from '../../lib/format.js'

// ---------------------------------------------------------------------------
// Reimbursements and deductions, attributed to the load that caused them.
//
// The owner/operator statement shows these twice on purpose, and the two
// answers are different questions. This table answers "what did THIS trip cost
// me" -- the tolls on the Chicago run, the lumper in Peoria. The details
// section further down answers "what am I spending on tolls" across the week
// and the year. A contractor deciding whether a lane is worth running needs the
// first; one deciding whether to change fuel cards needs the second.
//
// Lines with no order number are dropped rather than shown with a blank cell.
// A truck payment is not attributable to a load -- it is owed whether the truck
// moved or not -- and listing it here under an empty order number would suggest
// a trip cost more than it did. Those lines still appear in the details below,
// so nothing goes missing.
// ---------------------------------------------------------------------------
export default function LinesByLoad({ title, lines, routes, emptyNote }) {
  const attributed = lines.filter((l) => l.orderNo)

  // The dispatch number is not on the line -- SettlementLines has no such
  // column, because the dispatch belongs to the trip and not to a toll paid
  // during it. It is looked up from the route with the same order number,
  // which is where it actually lives. The original carried a DISPATCH_NUMBER
  // on its deduction table and so had two copies to disagree with each other.
  const dispatchByOrder = new Map(routes.map((r) => [r.orderNo, r.dispatchNo]))

  if (!attributed.length) {
    return (
      <div className="stmt-block">
        <h2>{title}</h2>
        <p className="muted">{emptyNote}</p>
      </div>
    )
  }

  const total = attributed.reduce((t, l) => t + l.amount, 0)

  return (
    <div className="stmt-block">
      <h2>{title}</h2>

      <div className="stmt-byload">
        <div className="stmt-row stmt-head">
          <div>Order</div>
          <div>Dispatch</div>
          <div>Type</div>
          <div className="num">Amount</div>
        </div>

        {attributed.map((l, i) => (
          <div className="stmt-row" key={`${l.orderNo}-${l.description}-${i}`}>
            <div>{l.orderNo}</div>
            <div className="muted">{dispatchByOrder.get(l.orderNo) || '—'}</div>
            <div>
              {l.description}
              {l.advanceReference && <span className="muted"> — {l.advanceReference}</span>}
            </div>
            <div className="num">{formatMoney(l.amount)}</div>
          </div>
        ))}

        <div className="stmt-row stmt-subtotal">
          <div />
          <div />
          <div />
          <div className="num">{formatMoney(total)}</div>
        </div>
      </div>
    </div>
  )
}
