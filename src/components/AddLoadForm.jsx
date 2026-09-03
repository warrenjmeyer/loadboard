import { useState } from 'react'
import { Link } from 'react-router-dom'

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
//
// `onAddLoad` is now async: it posts to /api/loads and either resolves with
// the row the database wrote or rejects with something worth reading. Two
// pieces of state come out of that -- `saving` while it is in flight, and
// `error` when it comes back refused. Both are local for the same reason the
// draft is: App has no use for either.
// ---------------------------------------------------------------------------
export default function AddLoadForm({ onAddLoad, user, canAdd }) {
  const [form, setForm] = useState(BLANK)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // One handler for every field. `name` on the input matches the key in state,
  // and the spread copies the old object before overwriting one key -- again,
  // a new object, never a mutation of the old one.
  function handleChange(e) {
    const { name, value } = e.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  async function handleSubmit(e) {
    // Without this the browser does a full page POST and reload, which throws
    // away all your React state. You will forget this once; everyone does.
    e.preventDefault()

    // A second submit while the first is still in the air would post the same
    // load twice. The button is disabled below, but Enter in a text field
    // submits too, so the guard belongs here rather than only in the markup.
    if (saving) return

    setSaving(true)
    setError(null)

    try {
      await onAddLoad({
        ...form,
        // Inputs always give you strings, even type="number". Convert before
        // the value reaches anything that does math with it.
        miles: Number(form.miles),
        rate: Number(form.rate),
      })

      // Only now. Clearing the form before the round trip finishes would lose
      // what someone typed the moment the network hiccuped -- and the form is
      // where they would have to type it all again.
      setForm(BLANK)
      setOpen(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // `undefined` means /api/me has not answered yet. Render nothing rather
  // than guess: both guesses are wrong half the time, and either one flickers
  // into the other a moment later.
  if (user === undefined) return null

  // The POST is gated inside the function itself, so none of this is the
  // security boundary -- it is the difference between a form that refuses you
  // after you have filled it in and one that tells you up front.
  if (!user) {
    return (
      <p className="muted signin-note">
        <Link className="signin" to="/signin">Sign in</Link> to add a load.
      </p>
    )
  }

  // Signed in, but not allowed. Saying which of the two it is matters: an
  // account waiting for approval is a queue, and an account with the wrong
  // role is a decision. They call for different next steps.
  if (!canAdd) {
    return (
      <p className="muted signin-note">
        {user.pendingApproval
          ? 'Your account is waiting for approval before you can add loads.'
          : 'Your account does not have permission to add loads.'}
      </p>
    )
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

      {error && <div className="error">{error}</div>}

      {/* fieldset disabled cascades to every control inside it, which is
          shorter and harder to get wrong than a disabled prop on each one. */}
      <fieldset disabled={saving}>
        <div className="grid">
          <label>
            Load #
            <input name="id" value={form.id} onChange={handleChange} maxLength={20} required />
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
            <input name="origin" value={form.origin} onChange={handleChange} maxLength={100} required />
          </label>
          <label>
            Destination
            <input name="destination" value={form.destination} onChange={handleChange} maxLength={100} required />
          </label>
          <label>
            Miles
            <input name="miles" type="number" min="1" step="1" value={form.miles} onChange={handleChange} required />
          </label>
          <label>
            Rate ($)
            <input name="rate" type="number" min="0" step="0.01" value={form.rate} onChange={handleChange} required />
          </label>
        </div>

        <div className="actions">
          <button type="submit" className="primary">
            {saving ? 'Saving...' : 'Save'}
          </button>
          {/* type="button" matters: inside a <form>, a button with no type
              defaults to type="submit" and would fire handleSubmit. */}
          <button type="button" onClick={() => { setForm(BLANK); setError(null); setOpen(false) }}>
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  )
}
