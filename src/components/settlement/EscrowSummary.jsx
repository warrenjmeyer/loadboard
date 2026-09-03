import { formatMoney } from '../../lib/format.js'

// ---------------------------------------------------------------------------
// Escrow and loan balances.
//
// Escrow is money the carrier holds on the driver's behalf -- a maintenance
// fund, a tire fund -- built up out of weekly deductions and paid back when the
// contract ends or the repair happens. It has no company-driver equivalent,
// which is why this component only appears on the owner/operator statement.
//
// It is deliberately NOT part of the settlement total. The weekly contribution
// is already sitting in the deductions above; counting the balance as income
// here would be double-counting it, and it is not money the driver can spend
// this week in any case. The note under the table says so, because a column of
// four-figure balances next to a four-figure settlement invites exactly that
// misreading.
//
// Every row is shown, including one whose balance is still zero. The original
// hid any row where the beginning or current balance was zero, which meant a
// newly opened account -- the one a driver most wants to watch start -- was
// the one row they could not see.
// ---------------------------------------------------------------------------
export default function EscrowSummary({ escrow, total }) {
  if (!escrow.length) return null

  return (
    <div className="stmt-block">
      <h2>Escrow &amp; Loan Summary</h2>

      <div className="stmt-escrow">
        <div className="stmt-row stmt-head">
          <div>Account</div>
          <div className="num">Beginning Balance</div>
          <div className="num">Change</div>
          <div className="num">Ending Balance</div>
        </div>

        {escrow.map((e) => (
          <div className="stmt-row" key={e.code}>
            <div>{e.description}</div>
            <div className="num">{formatMoney(e.beginningBalance)}</div>
            {/* Signed the way it moves the balance, and shown with its sign:
                a contribution adds, a repair drawn against the fund takes
                away, and "125.00" in a column called Change cannot tell you
                which of those happened. */}
            <div className="num">
              {e.transactionAmount > 0 ? '+' : ''}
              {formatMoney(e.transactionAmount)}
            </div>
            <div className="num">{formatMoney(e.currentBalance)}</div>
          </div>
        ))}

        <div className="stmt-row stmt-subtotal">
          <div>Total held</div>
          <div className="num" />
          <div className="num" />
          <div className="num">{formatMoney(total)}</div>
        </div>
      </div>

      <p className="stmt-note muted">
        Held by Millstream on your behalf. These balances are not part of the
        settlement total above — this week&apos;s contribution already appears
        as a deduction.
      </p>
    </div>
  )
}
