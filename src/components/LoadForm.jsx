// ---------------------------------------------------------------------------
// The fields of a load, as a form.
//
// Shared by the add form on the board and the edit panel on a load's page.
// One set of inputs, so a field added to the load is added to both screens
// at once and the two cannot drift -- the edit form is not a slightly
// different, slightly older copy of the add form.
//
// This is a controlled, presentational component: `form` comes in, every
// keystroke goes out through onChange. It owns nothing. Whether the form is
// disabled, what happens on submit, and what the buttons say are the caller's
// business, which is why there is no <form> and no button here.
// ---------------------------------------------------------------------------

export const EQUIPMENT = ['Dry Van', 'Reefer', 'Flatbed']

// Every field, as an empty string, in the shape an input can hold. Numbers are
// strings here because that is what inputs give back; formToBody converts.
export const BLANK_LOAD = {
  id: '',
  origin: '',
  destination: '',
  miles: '',
  emptyMiles: '',
  rate: '',
  equipment: 'Dry Van',
  pickupStart: '',
  pickupEnd: '',
  deliveryStart: '',
  deliveryEnd: '',
  customerId: '',
  customerName: '',
  referenceNo: '',
  shipperName: '',
  shipperAddress: '',
  shipperPhone: '',
  consigneeName: '',
  consigneeAddress: '',
  consigneePhone: '',
  commodity: '',
  weightLbs: '',
  pieces: '',
  hazmat: false,
  tempF: '',
  notes: '',
}

// A saved load, as the form holds it. Nulls become empty strings, numbers
// become strings, and datetimes lose their seconds because datetime-local
// wants 'YYYY-MM-DDTHH:mm' and shows a broken control for anything longer.
export function loadToForm(load) {
  const form = {}
  for (const key of Object.keys(BLANK_LOAD)) {
    const v = load[key]
    if (key === 'hazmat') form[key] = Boolean(v)
    else if (v === null || v === undefined) form[key] = ''
    else if (/^(pickup|delivery)/.test(key)) form[key] = String(v).slice(0, 16)
    else form[key] = String(v)
  }
  return form
}

// The form, as the API wants it. Empty strings become null so the server
// clears the field rather than storing ''. `only` restricts the body to the
// keys named, which is how the edit panel sends just what changed.
export function formToBody(form, only = null) {
  const body = {}
  for (const key of Object.keys(BLANK_LOAD)) {
    if (only && !only.includes(key)) continue
    const v = form[key]
    if (key === 'hazmat') body[key] = Boolean(v)
    else if (v === '' || v === null || v === undefined) body[key] = null
    else if (['miles', 'emptyMiles', 'rate', 'weightLbs', 'pieces', 'tempF', 'customerId'].includes(key)) body[key] = Number(v)
    else body[key] = v
  }
  return body
}

// Which keys differ between a saved load and the form, so an edit sends only
// those. Comparing through loadToForm puts both sides in the same shape --
// 585 against '585' would otherwise always look changed.
export function changedKeys(load, form) {
  const before = loadToForm(load)
  return Object.keys(BLANK_LOAD).filter((k) => k !== 'id' && String(before[k]) !== String(form[k]))
}

// `customers` is the list from /api/customers, or null when the caller has no
// business seeing it. With a list the customer is a dropdown that sets
// customerId and the server fills the name in; without one it is the text
// box it always was, which is also the fallback for a load whose typed name
// matches no record.
export default function LoadForm({ form, onChange, showId = false, customers = null }) {
  // One handler for every field. `name` on the input matches the key in
  // state. A checkbox reports `checked` rather than `value`, and this is the
  // only place that difference has to be known.
  function handleChange(e) {
    const { name, value, type, checked } = e.target
    onChange(name, type === 'checkbox' ? checked : value)
  }

  return (
    <>
      <div className="grid">
        {showId && (
          <label>
            Load #
            <input name="id" value={form.id} onChange={handleChange} maxLength={20} required />
          </label>
        )}
        <label>
          Equipment
          <select name="equipment" value={form.equipment} onChange={handleChange}>
            {EQUIPMENT.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        </label>
        <label>
          Origin
          <input name="origin" value={form.origin} onChange={handleChange} maxLength={100} placeholder="City, ST" required />
        </label>
        <label>
          Destination
          <input name="destination" value={form.destination} onChange={handleChange} maxLength={100} placeholder="City, ST" required />
        </label>
        <label>
          Miles
          <input name="miles" type="number" min="1" step="1" value={form.miles} onChange={handleChange} required />
        </label>
        <label>
          Rate ($)
          <input name="rate" type="number" min="0" step="0.01" value={form.rate} onChange={handleChange} required />
        </label>
        {/* Deadhead: from wherever the truck delivered last to this pickup.
            Paid on a settlement, so it belongs on the load, not in someone's
            head. Zero until dispatch knows. */}
        <label>
          Empty miles
          <input name="emptyMiles" type="number" min="0" step="1" value={form.emptyMiles} onChange={handleChange} placeholder="0" />
        </label>
      </div>

      {/* Appointments. datetime-local gives the browser's own picker and hands
          back 'YYYY-MM-DDTHH:mm' with no timezone -- which is exactly right,
          because the time is the dock's, not the dispatcher's. */}
      <h3>Appointments</h3>
      <div className="grid">
        <label>
          Pickup from
          <input name="pickupStart" type="datetime-local" value={form.pickupStart} onChange={handleChange} />
        </label>
        <label>
          Pickup until
          <input name="pickupEnd" type="datetime-local" value={form.pickupEnd} onChange={handleChange} />
        </label>
        <label>
          Deliver from
          <input name="deliveryStart" type="datetime-local" value={form.deliveryStart} onChange={handleChange} />
        </label>
        <label>
          Deliver until
          <input name="deliveryEnd" type="datetime-local" value={form.deliveryEnd} onChange={handleChange} />
        </label>
      </div>

      <h3>Customer and stops</h3>
      <div className="grid">
        <label>
          Customer / broker
          {customers ? (
            <select name="customerId" value={form.customerId} onChange={handleChange}>
              <option value="">{form.customerName ? `— ${form.customerName} (not linked) —` : '— none —'}</option>
              {customers.map((c) => (
                <option key={c.customerId} value={String(c.customerId)}>
                  {c.name}{c.status !== 'Active' ? ` · ${c.status.toUpperCase()}` : ''}
                </option>
              ))}
            </select>
          ) : (
            <input name="customerName" value={form.customerName} onChange={handleChange} maxLength={100} />
          )}
        </label>
        <label>
          Reference # (PO / BOL)
          <input name="referenceNo" value={form.referenceNo} onChange={handleChange} maxLength={40} />
        </label>
      </div>
      <div className="grid">
        <label>
          Shipper
          <input name="shipperName" value={form.shipperName} onChange={handleChange} maxLength={100} />
        </label>
        <label className="wide">
          Shipper address
          <input name="shipperAddress" value={form.shipperAddress} onChange={handleChange} maxLength={200} />
        </label>
        <label>
          Shipper phone
          <input name="shipperPhone" type="tel" value={form.shipperPhone} onChange={handleChange} maxLength={30} />
        </label>
      </div>
      <div className="grid">
        <label>
          Consignee
          <input name="consigneeName" value={form.consigneeName} onChange={handleChange} maxLength={100} />
        </label>
        <label className="wide">
          Consignee address
          <input name="consigneeAddress" value={form.consigneeAddress} onChange={handleChange} maxLength={200} />
        </label>
        <label>
          Consignee phone
          <input name="consigneePhone" type="tel" value={form.consigneePhone} onChange={handleChange} maxLength={30} />
        </label>
      </div>

      <h3>Freight</h3>
      <div className="grid">
        <label>
          Commodity
          <input name="commodity" value={form.commodity} onChange={handleChange} maxLength={100} />
        </label>
        <label>
          Weight (lbs)
          <input name="weightLbs" type="number" min="1" step="1" value={form.weightLbs} onChange={handleChange} />
        </label>
        <label>
          Pieces
          <input name="pieces" type="number" min="1" step="1" value={form.pieces} onChange={handleChange} />
        </label>
        {/* The set point only means something on a reefer, but the field is
            not hidden on the others: a dispatcher switching a load from Dry
            Van to Reefer should not have the box appear from nowhere, and a
            value typed on a dry van is harmless. */}
        <label>
          Temp (°F){form.equipment !== 'Reefer' && <span className="muted"> · reefer only</span>}
          <input name="tempF" type="number" min="-100" max="200" step="1" value={form.tempF} onChange={handleChange} />
        </label>
        <label className="checkbox">
          <input name="hazmat" type="checkbox" checked={form.hazmat} onChange={handleChange} />
          Hazmat
        </label>
      </div>

      <label className="block">
        Notes for the driver
        <textarea name="notes" value={form.notes} onChange={handleChange} maxLength={1000} rows={3} />
      </label>
    </>
  )
}
