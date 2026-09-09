// ---------------------------------------------------------------------------
// Add or edit a truck. Controlled: `form` in, onChange(name, value) out. The
// page owns the submit, the saving state and the error, the same split as
// LoadForm against AddLoadForm.
//
// `isNew` shows the unit number box; an existing truck's number is its key
// and does not change.
// ---------------------------------------------------------------------------
export const BLANK_TRUCK = {
  unitNo: '', description: '', modelYear: '', make: '', model: '', vin: '',
  plate: '', plateState: '', status: 'Active', ownerType: 'COMPANY', ownerDriverCode: '',
  registrationExpires: '', inspectionDue: '', notes: '',
}

export function truckToForm(t) {
  const f = {}
  for (const k of Object.keys(BLANK_TRUCK)) f[k] = t[k] === null || t[k] === undefined ? '' : String(t[k])
  return f
}

export function truckFormToBody(form, only = null) {
  const body = {}
  for (const k of Object.keys(BLANK_TRUCK)) {
    if (k === 'unitNo') continue
    if (only && !only.includes(k)) continue
    body[k] = form[k] === '' ? null : k === 'modelYear' ? Number(form[k]) : form[k]
  }
  return body
}

export default function TruckForm({ form, onChange, isNew = false, drivers = [] }) {
  const set = (e) => onChange(e.target.name, e.target.value)

  return (
    <>
      <div className="grid">
        {isNew && (
          <label>
            Unit #
            <input name="unitNo" value={form.unitNo} onChange={set} maxLength={20} required placeholder="Demo - 25" />
          </label>
        )}
        <label className="wide">
          Description
          <input name="description" value={form.description} onChange={set} maxLength={80} required placeholder="2021 Freightliner Cascadia" />
        </label>
        <label>
          Year
          <input name="modelYear" type="number" min="1980" max="2100" value={form.modelYear} onChange={set} />
        </label>
        <label>
          Make
          <input name="make" value={form.make} onChange={set} maxLength={40} />
        </label>
        <label>
          Model
          <input name="model" value={form.model} onChange={set} maxLength={40} />
        </label>
        <label>
          VIN
          <input name="vin" value={form.vin} onChange={set} maxLength={17} className="mono" />
        </label>
        <label>
          Plate
          <input name="plate" value={form.plate} onChange={set} maxLength={12} />
        </label>
        <label>
          Plate state
          <input name="plateState" value={form.plateState} onChange={set} maxLength={2} placeholder="IA" />
        </label>
        <label>
          Status
          <select name="status" value={form.status} onChange={set}>
            <option>Active</option>
            <option>Shop</option>
            <option>Retired</option>
          </select>
        </label>
        <label>
          Owned by
          <select name="ownerType" value={form.ownerType} onChange={set}>
            <option value="COMPANY">The company</option>
            <option value="OWNER">An owner/operator</option>
          </select>
        </label>
        {form.ownerType === 'OWNER' && (
          <label>
            Owner
            <select name="ownerDriverCode" value={form.ownerDriverCode} onChange={set} required>
              <option value="">— choose —</option>
              {drivers.map((d) => (
                <option key={d.driverCode} value={d.driverCode}>{d.name} ({d.driverCode})</option>
              ))}
            </select>
          </label>
        )}
        <label>
          Registration expires
          <input name="registrationExpires" type="date" value={form.registrationExpires} onChange={set} />
        </label>
        <label>
          Inspection due
          <input name="inspectionDue" type="date" value={form.inspectionDue} onChange={set} />
        </label>
      </div>
      <label className="block">
        Notes
        <textarea name="notes" value={form.notes} onChange={set} maxLength={400} rows={2} />
      </label>
    </>
  )
}
