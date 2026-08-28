import { useState } from 'react'

const BLANK = {
  id: '',
  origin: '',
  destination: '',
  miles: '',
  rate: '',
  equipment: 'Dry Van',
}

// ---------------------------------------------------------------------------
// This component DOES own state -- the half-typed form. Nobody else needs to
// see a draft, so it stays local. Only the finished load is handed up to App
// through the onAddLoad callback prop.
//
// That is the data flow rule in one sentence: data flows down through props,
// events flow up through callbacks. There is no two-way binding in React.
// ---------------------------------------------------------------------------
export default function AddLoadForm({ onAddLoad }) {
  const [form, setForm] = useState(BLANK)
  const [open, setOpen] = useState(false)

  // One handler for every field. `name` on the input matches the key in state,
  // and the spread copies the old object before overwriting one key -- again,
  // a new object, never a mutation of the old one.
  function handleChange(e) {
    const { name, value } = e.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  function handleSubmit(e) {
    // Without this the browser does a full page POST and reload, which throws
    // away all your React state. You will forget this once; everyone does.
    e.preventDefault()

    onAddLoad({
      ...form,
      // Inputs always give you strings, even type="number". Convert before
      // the value reaches anything that does math with it.
      miles: Number(form.miles),
      rate: Number(form.rate),
      status: 'Available',
    })

    setForm(BLANK)
    setOpen(false)
  }

  if (!open) {
    return (
      <button className="primary" onClick={() => setOpen(true)}>
        + Add load
      </button>
    )
  }

  return (
    <form className="add-form" onSubmit={handleSubmit}>
      <h2>New load</h2>

      <div className="grid">
        <label>
          Load #
          <input name="id" value={form.id} onChange={handleChange} required />
        </label>
        <label>
          Equipment
          <select name="equipment" value={form.equipment} onChange={handleChange}>
            <option>Dry Van</option>
            <option>Reefer</option>
            <option>Flatbed</option>
          </select>
        </label>
        <label>
          Origin
          <input name="origin" value={form.origin} onChange={handleChange} required />
        </label>
        <label>
          Destination
          <input name="destination" value={form.destination} onChange={handleChange} required />
        </label>
        <label>
          Miles
          <input name="miles" type="number" min="1" value={form.miles} onChange={handleChange} required />
        </label>
        <label>
          Rate ($)
          <input name="rate" type="number" min="1" value={form.rate} onChange={handleChange} required />
        </label>
      </div>

      <div className="actions">
        <button type="submit" className="primary">Save</button>
        {/* type="button" matters: inside a <form>, a button with no type
            defaults to type="submit" and would fire handleSubmit. */}
        <button type="button" onClick={() => { setForm(BLANK); setOpen(false) }}>
          Cancel
        </button>
      </div>
    </form>
  )
}
