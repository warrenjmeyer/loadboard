import { useState } from 'react'
import { Link } from 'react-router-dom'
import { register } from '../lib/auth.js'

const MIN_PASSWORD = 12

// ---------------------------------------------------------------------------
// Create an account.
//
// The rules shown here match the ones the API enforces, and the API is the one
// that counts -- this only exists so somebody is told before submitting rather
// than after. Every check is repeated server-side in register.js, because a
// rule that lives only in the browser is a suggestion.
//
// Note what is NOT here: no "must contain a capital and a symbol". Current
// guidance drops composition rules because they reliably produce Password1!,
// and screens against real breach data instead -- which the API does, and
// which no amount of client-side JavaScript could.
// ---------------------------------------------------------------------------
export default function Register() {
  const [form, setForm] = useState({ displayName: '', email: '', password: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)

  function update(e) {
    const { name, value } = e.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  // Checked here rather than server-side because it is not a password rule at
  // all -- the API has no opinion about whether you typed it twice. It exists
  // to catch a typo before it becomes an account nobody can sign in to.
  const mismatch = form.confirm.length > 0 && form.password !== form.confirm

  async function handleSubmit(e) {
    e.preventDefault()
    if (busy || mismatch) return

    setBusy(true)
    setError(null)

    try {
      const result = await register({
        email: form.email,
        password: form.password,
        displayName: form.displayName,
      })
      setDone(result.message)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="page auth-page">
        <h1>Check your email</h1>
        <p className="muted">{done}</p>
        <p className="muted">
          The link confirms your address and works once. Confirming it does not
          finish the job — an administrator still has to approve the account
          before it can do anything.
        </p>
        <nav className="board-nav">
          <Link to="/signin">Sign in</Link>
          <Link to="/">← The load board</Link>
        </nav>
      </div>
    )
  }

  return (
    <div className="page auth-page">
      <h1>Create an account</h1>
      <p className="sub">
        New accounts start with no access. An administrator approves them.
      </p>

      {error && <div className="error">{error}</div>}

      <form className="add-form" onSubmit={handleSubmit}>
        <fieldset disabled={busy}>
          <label>
            Your name
            <input name="displayName" value={form.displayName} onChange={update} maxLength={100} />
          </label>

          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="username"
              value={form.email}
              onChange={update}
              required
            />
          </label>

          <label>
            Password
            {/* new-password, not current-password: it tells a password manager
                to offer to GENERATE one rather than fill an existing one. */}
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD}
              value={form.password}
              onChange={update}
              required
            />
          </label>

          <label>
            Confirm password
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              value={form.confirm}
              onChange={update}
              required
            />
          </label>

          {mismatch && <p className="field-error">Those two passwords do not match.</p>}

          <p className="muted hint">
            At least {MIN_PASSWORD} characters. A phrase of a few words beats a
            short scramble. It is checked against known breached passwords, so
            anything you have used elsewhere may be refused.
          </p>

          <div className="actions">
            <button type="submit" className="primary" disabled={mismatch}>
              {busy ? 'Creating...' : 'Create account'}
            </button>
          </div>
        </fieldset>
      </form>

      <nav className="board-nav">
        <Link to="/signin">Already have an account? Sign in</Link>
        <Link to="/">← The load board</Link>
      </nav>
    </div>
  )
}
