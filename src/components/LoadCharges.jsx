import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formatMoney, formatDate } from '../lib/format.js'

// ---------------------------------------------------------------------------
// The accessorials on a load: what they are, who is paid, whether the
// customer is billed, and which statement paid each one.
//
// Presentational plus a small form. The list and the permissions come in as
// props; onAdd(body) and onRemove(chargeId) go out. `canAdd` is either
// 'all' (dispatch), 'reimbursement' (the driver on the load, holding a
// receipt), or null. The server decides the same thing again.
// ---------------------------------------------------------------------------

const CODES = [
  ['DETENTION', 'Detention', 'REVENUE'],
  ['LAYOVER', 'Layover', 'REVENUE'],
  ['STOPOFF', 'Stop-off pay', 'REVENUE'],
  ['FSC', 'Fuel surcharge', 'REVENUE'],
  ['TOLLS', 'Tolls', 'REIMBURSEMENT'],
  ['LUMPER', 'Lumper', 'REIMBURSEMENT'],
  ['SCALE', 'Scale', 'REIMBURSEMENT'],
  ['WASHOUT', 'Wash-out', 'REIMBURSEMENT'],
  ['OTHER', 'Other', null],
]

const BLANK = { code: 'TOLLS', lineType: '', description: '', amount: '', billCustomer: false, billAmount: '', receiptNote: '' }

export default function LoadCharges({ charges, canAdd = null, canRemove = false, onAdd, onRemove }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(BLANK)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const offered = CODES.filter(([, , type]) => canAdd === 'all' || type === 'REIMBURSEMENT')

  function set(e) {
    const { name, value, type, checked } = e.target
    setForm((f) => ({ ...f, [name]: type === 'checkbox' ? checked : value }))
  }

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onAdd({
        code: form.code,
        lineType: form.code === 'OTHER' ? form.lineType : undefined,
        description: form.description || undefined,
        amount: Number(form.amount),
        billCustomer: form.billCustomer,
        billAmount: form.billCustomer && form.billAmount !== '' ? Number(form.billAmount) : undefined,
        receiptNote: form.receiptNote || undefined,
      })
      setForm(BLANK)
      setOpen(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onRemove(id)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const total = charges.reduce((t, c) => t + c.amount, 0)

  return (
    <section className="charges">
      {error && <div className="error">{error}</div>}

      {charges.length === 0 ? (
        <p className="muted">No accessorials on this load.</p>
      ) : (
        <div className="table-scroll">
          <table className="loads">
            <thead>
              <tr>
                <th>Charge</th>
                <th>Kind</th>
                <th className="num">To driver</th>
                <th>Billed</th>
                <th>Paid on</th>
                <th>Entered</th>
                {canRemove && <th />}
              </tr>
            </thead>
            <tbody>
              {charges.map((c) => (
                <tr key={c.chargeId}>
                  <td>
                    {c.description}
                    {c.receiptNote && <div className="muted small">{c.receiptNote}</div>}
                  </td>
                  <td>{c.lineType === 'REVENUE' ? 'extra pay' : 'money back'}</td>
                  <td className="num">{formatMoney(c.amount)}</td>
                  <td className="nowrap">
                    {c.billCustomer ? formatMoney(c.billAmount ?? c.amount) : <span className="muted">—</span>}
                    {c.billedOn && (
                      <span className="small"> · <Link to={`/invoices/${encodeURIComponent(c.billedOn.invoiceNo)}`}>{c.billedOn.invoiceNo}</Link></span>
                    )}
                  </td>
                  <td className="nowrap">
                    {c.paidOn ? (
                      <Link to={`/settlements/${encodeURIComponent(c.paidOn.driverCode)}?date=${c.paidOn.checkDate}`}>
                        {c.paidOn.documentNo}
                      </Link>
                    ) : <span className="muted">not yet</span>}
                  </td>
                  <td className="muted small">{c.createdBy || ''}{c.createdUtc ? ` · ${formatDate(c.createdUtc.slice(0, 10))}` : ''}</td>
                  {canRemove && (
                    <td>
                      {!c.paidOn && !c.billedOn && (
                        <button type="button" className="linklike" disabled={busy} onClick={() => remove(c.chargeId)}>Remove</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>{charges.length} charge{charges.length === 1 ? '' : 's'}</td>
                <td className="num">{formatMoney(total)}</td>
                <td colSpan={canRemove ? 4 : 3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {canAdd && !open && (
        <p><button type="button" onClick={() => setOpen(true)}>{canAdd === 'all' ? '+ Add charge' : '+ Turn in a receipt'}</button></p>
      )}

      {canAdd && open && (
        <form className="add-form" onSubmit={submit}>
          <h2>{canAdd === 'all' ? 'New charge' : 'Turn in a receipt'}</h2>
          <fieldset disabled={busy}>
            <div className="grid">
              <label>
                What
                <select name="code" value={form.code} onChange={set}>
                  {offered.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                </select>
              </label>
              {form.code === 'OTHER' && (
                <label>
                  Kind
                  <select name="lineType" value={form.lineType} onChange={set} required>
                    <option value="">— choose —</option>
                    {canAdd === 'all' && <option value="REVENUE">Extra pay</option>}
                    <option value="REIMBURSEMENT">Money back</option>
                  </select>
                </label>
              )}
              <label>
                Amount ($)
                <input name="amount" type="number" min="0.01" step="0.01" value={form.amount} onChange={set} required />
              </label>
              <label className="wide">
                Description on the statement<span className="muted"> · optional, e.g. DETENTION - 2 HRS</span>
                <input name="description" value={form.description} onChange={set} maxLength={120} />
              </label>
              <label className="wide">
                Receipt / note
                <input name="receiptNote" value={form.receiptNote} onChange={set} maxLength={200} placeholder="Receipt #, where, why" />
              </label>
              {canAdd === 'all' && (
                <>
                  <label className="checkbox">
                    <input name="billCustomer" type="checkbox" checked={form.billCustomer} onChange={set} />
                    Bill the customer
                  </label>
                  {form.billCustomer && (
                    <label>
                      Billed amount ($)<span className="muted"> · blank = same</span>
                      <input name="billAmount" type="number" min="0" step="0.01" value={form.billAmount} onChange={set} />
                    </label>
                  )}
                </>
              )}
            </div>
            <div className="actions">
              <button type="submit" className="primary">{busy ? 'Saving...' : 'Save'}</button>
              <button type="button" onClick={() => { setOpen(false); setForm(BLANK); setError(null) }}>Cancel</button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  )
}
