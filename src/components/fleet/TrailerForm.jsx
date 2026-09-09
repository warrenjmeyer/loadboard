export const BLANK_TRAILER = {
  trailerNo: '', trailerType: 'Dry Van', description: '', plate: '', plateState: '',
  status: 'Active', registrationExpires: '', inspectionDue: '', notes: '',
}

export function trailerToForm(t) {
  const f = {}
  for (const k of Object.keys(BLANK_TRAILER)) f[k] = t[k] === null || t[k] === undefined ? '' : String(t[k])
  return f
}

export function trailerFormToBody(form, only = null) {
  const body = {}
  for (const k of Object.keys(BLANK_TRAILER)) {
    if (k === 'trailerNo') continue
    if (only && !only.includes(k)) continue
    body[k] = form[k] === '' ? null : form[k]
  }
  return body
}

export default function TrailerForm({ form, onChange, isNew = false }) {
  const set = (e) => onChange(e.target.name, e.target.value)

  return (
    <>
      <div className="grid">
        {isNew && (
          <label>
            Trailer #
            <input name="trailerNo" value={form.trailerNo} onChange={set} maxLength={20} required placeholder="T-113" />
          </label>
        )}
        <label>
          Type
          <select name="trailerType" value={form.trailerType} onChange={set}>
            <option>Dry Van</option>
            <option>Reefer</option>
            <option>Flatbed</option>
          </select>
        </label>
        <label className="wide">
          Description
          <input name="description" value={form.description} onChange={set} maxLength={80} placeholder="53' Utility 3000R" />
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
