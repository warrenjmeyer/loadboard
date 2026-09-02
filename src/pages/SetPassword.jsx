import { useState } from 'react'
import { resetPassword } from '../lib/auth.js'

const MIN_PASSWORD = 12

// ---------------------------------------------------------------------------
// Where the emailed reset link lands.
//
// The token arrived in the URL and has already been taken out of the address
// bar by takeTokenFromUrl -- it lives only in this component's props from here
// on, so it is not left behind in browser history or in a screenshot.
//
// The token is spent by the API, not by opening this page. Someone can arrive
// here, change their mind, and their existing password is untouched.
// ---------------------------------------------------------------------------
export default function SetPassword({ token }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)

  const mismatch = confirm.length > 0 && password !== confirm

  async function handleSubmit(e) {
    e.preventDefault()
    if (busy || mismatch) return

    setBusy(true)
    setError(null)

    try {
      const result = await resetPassword(token, password)
      setDone(result.message)
    } catch (err) {
      // A rejected password does NOT burn the link -- the API checks the
      // password before spending the token -- so the form stays usable and
      // they can simply try a different one.
      setError(err.message)
      setPassword('')
      setConfirm('')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="page auth-page">
        <h1>Password changed</h1>
        <p className="muted">{done}</p>
        <nav className="board-nav">
          <a href="?signin=1">Sign in</a>
        </nav>
      </div>
    )
  }

  return (
    <div className="page auth-page">
      <h1>Choose a new password</h1>
      <p className="sub">
        This link works once. Nothing has changed on your account yet.
      </p>

      {error && <div className="error">{error}</div>}

      <form className="add-form" onSubmit={handleSubmit}>
        <fieldset disabled={busy}>
          <label>
            New password
            <input
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
            />
          </label>

          <label>
            Confirm new password
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </label>

          {mismatch && <p className="field-error">Those two passwords do not match.</p>}

          <p className="muted hint">
            At least {MIN_PASSWORD} characters, and checked against known
            breached passwords. Setting it signs you out everywhere else.
          </p>

          <div className="actions">
            <button type="submit" className="primary" disabled={mismatch}>
              {busy ? 'Saving...' : 'Set password'}
            </button>
          </div>
        </fieldset>
      </form>
    </div>
  )
}
