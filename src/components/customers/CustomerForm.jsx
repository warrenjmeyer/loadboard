// ---------------------------------------------------------------------------
// Add or edit a customer. Controlled; the page owns submit, saving and error.
// ---------------------------------------------------------------------------
export const BLANK_CUSTOMER = {
  name: '', customerType: 'Broker', mcNumber: '', address1: '', city: '', state: '', postalCode: '',
  phone: '', email: '', contactName: '', paymentTermsDays: '30', creditLimit: '', status: 'Active', notes: '',
}

export function customerToForm(c) {
  const f = {}
  for (const k of Object.keys(BLANK_CUSTOMER)) f[k] = c[k] === null || c[k] === undefined ? '' : String(c[k])
  return f
}

export function customerFormToBody(form, only = null) {
  const body = {}
  for (const k of Object.keys(BLANK_CUSTOMER)) {
    if (only && !only.includes(k)) continue
    const v = form[k]
    body[k] = v === '' ? null : ['paymentTermsDays', 'creditLimit'].includes(k) ? Number(v) : v
  }
  return body
}

export function changedCustomerKeys(saved, form) {
  const before = customerToForm(saved)
  return Object.keys(BLANK_CUSTOMER).filter((k) => String(before[k]) !== String(form[k]))
}

export default function CustomerForm({ form, onChange }) {
  const set = (e) => onChange(e.target.name, e.target.value)

  return (
    <>
      <div className="grid">
        <label className="wide">
          Name
          <input name="name" value={form.name} onChange={set} maxLength={100} required />
        </label>
        <label>
          Type
          <select name="customerType" value={form.customerType} onChange={set}>
            <option>Broker</option>
            <option>Shipper</option>
          </select>
        </label>
        <label>
          MC number{form.customerType !== 'Broker' && <span className="muted"> · brokers</span>}
          <input name="mcNumber" value={form.mcNumber} onChange={set} maxLength={12} placeholder="MC-123456" className="mono" />
        </label>
        <label>
          Status
          <select name="status" value={form.status} onChange={set}>
            <option>Active</option>
            <option value="Hold">Hold — do not cover</option>
            <option>Inactive</option>
          </select>
        </label>
      </div>

      <h3>Contact</h3>
      <div className="grid">
        <label>
          Contact
          <input name="contactName" value={form.contactName} onChange={set} maxLength={80} />
        </label>
        <label>
          Phone
          <input name="phone" type="tel" value={form.phone} onChange={set} maxLength={30} />
        </label>
        <label>
          Email
          <input name="email" type="email" value={form.email} onChange={set} maxLength={254} />
        </label>
        <label className="wide">
          Address
          <input name="address1" value={form.address1} onChange={set} maxLength={100} />
        </label>
        <label>
          City
          <input name="city" value={form.city} onChange={set} maxLength={60} />
        </label>
        <label>
          State
          <input name="state" value={form.state} onChange={set} maxLength={2} placeholder="IA" />
        </label>
        <label>
          ZIP
          <input name="postalCode" value={form.postalCode} onChange={set} maxLength={10} />
        </label>
      </div>

      <h3>Terms</h3>
      <div className="grid">
        <label>
          Payment terms (days)
          <input name="paymentTermsDays" type="number" min="0" max="180" step="1" value={form.paymentTermsDays} onChange={set} />
        </label>
        <label>
          Credit limit ($)
          <input name="creditLimit" type="number" min="0" step="0.01" value={form.creditLimit} onChange={set} placeholder="none set" />
        </label>
      </div>

      <label className="block">
        Notes
        <textarea name="notes" value={form.notes} onChange={set} maxLength={1000} rows={3} />
      </label>
    </>
  )
}
