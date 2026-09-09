export const BLANK_DEDUCTION = {
  code: '', description: '', basis: 'FLAT', amount: '', kind: 'weekly',
  escrowCode: '', escrowOpening: '', balance: '', startDate: '', endDate: '', active: 'true', notes: '',
}

// `kind` is a form-only convenience: weekly, per mile, escrow, loan. The
// server does not have it; it has basis, escrowCode and balance, and kind
// decides which of those get sent.
export function deductionToForm(d) {
  const kind = d.escrowCode ? 'escrow' : d.balance !== null && d.balance !== undefined ? 'loan' : d.basis === 'PER_MILE' ? 'perMile' : 'weekly'
  const f = { ...BLANK_DEDUCTION, kind }
  for (const k of Object.keys(BLANK_DEDUCTION)) {
    if (k === 'kind') continue
    const v = d[k]
    f[k] = v === null || v === undefined ? '' : String(v)
  }
  return f
}

export function deductionFormToBody(form) {
  const kind = form.kind
  return {
    code: form.code.trim(),
    description: form.description.trim(),
    basis: kind === 'perMile' ? 'PER_MILE' : 'FLAT',
    amount: Number(form.amount),
    escrowCode: kind === 'escrow' ? form.escrowCode.trim() || form.code.trim() : null,
    escrowOpening: kind === 'escrow' && form.escrowOpening !== '' ? Number(form.escrowOpening) : null,
    balance: kind === 'loan' && form.balance !== '' ? Number(form.balance) : null,
    startDate: form.startDate || null,
    endDate: form.endDate || null,
    active: form.active === 'true',
    notes: form.notes.trim() || null,
  }
}

export default function DeductionForm({ form, onChange, isNew = false }) {
  const set = (e) => onChange(e.target.name, e.target.value)

  return (
    <>
      <div className="grid">
        <label>
          Code
          <input name="code" value={form.code} onChange={set} maxLength={20} required disabled={!isNew} className="mono" placeholder="TRUCKPAY" />
        </label>
        <label className="wide">
          Description (as printed)
          <input name="description" value={form.description} onChange={set} maxLength={120} required placeholder="TRUCK PAYMENT" />
        </label>
        <label>
          Kind
          <select name="kind" value={form.kind} onChange={set}>
            <option value="weekly">Same amount every settlement</option>
            <option value="perMile">Per mile paid</option>
            <option value="escrow">Escrow contribution</option>
            <option value="loan">Loan repayment</option>
          </select>
        </label>
        <label>
          {form.kind === 'perMile' ? 'Rate ($ per mile)' : 'Amount ($)'}
          <input name="amount" type="number" min="0.0001" step={form.kind === 'perMile' ? '0.0001' : '0.01'} value={form.amount} onChange={set} required />
        </label>
        {form.kind === 'escrow' && (
          <>
            <label>
              Escrow account code
              <input name="escrowCode" value={form.escrowCode} onChange={set} maxLength={20} className="mono" placeholder={form.code || 'MAINT'} />
            </label>
            <label>
              Opening balance ($)<span className="muted"> · if no statement has one</span>
              <input name="escrowOpening" type="number" min="0" step="0.01" value={form.escrowOpening} onChange={set} />
            </label>
          </>
        )}
        {form.kind === 'loan' && (
          <label>
            Still owed ($)<span className="muted"> · stops at zero</span>
            <input name="balance" type="number" min="0" step="0.01" value={form.balance} onChange={set} required />
          </label>
        )}
        <label>
          First check date
          <input name="startDate" type="date" value={form.startDate} onChange={set} />
        </label>
        <label>
          Last check date
          <input name="endDate" type="date" value={form.endDate} onChange={set} />
        </label>
        <label>
          Status
          <select name="active" value={form.active} onChange={set}>
            <option value="true">Active</option>
            <option value="false">Off</option>
          </select>
        </label>
      </div>
      <label className="block">
        Notes
        <textarea name="notes" value={form.notes} onChange={set} maxLength={400} rows={2} />
      </label>
    </>
  )
}
