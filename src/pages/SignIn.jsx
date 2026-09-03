import { useState } from 'react'
import { Link } from 'react-router-dom'
import { login, requestReset } from '../lib/auth.js'

// ---------------------------------------------------------------------------
// Sign in, and ask for a reset link.
//
// One component for both because they are one flow in practice: the moment
// someone discovers they have forgotten their password is while they are
// failing to type it. Sending them to a separate page loses the address they
// already entered, which is the small indignity that makes people give up.
// ---------------------------------------------------------------------------
export default function SignIn({ onSignedIn }) {
  const [mode, setMode] = useState('signin') // 'signin' | 'forgot'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [sent, setSent] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (busy) return

    setBusy(true)
    setError(null)

    try {
      if (mode === 'forgot') {
        const result = await requestReset(email)
        // The server says the same thing whether or not that address exists,
        // and so does this. Showing "we sent it" only for real accounts would
        // hand back the enumeration oracle the API just closed.
        setSent(result.message)
      } else {
        const result = await login(email, password)
        onSignedIn(result.user)
      }
    } catch (err) {
      setError(err.message)
      // Clear the password on failure, not the address. Retyping an email you
      // already got right is annoying; leaving a wrong password in the box is
      // worse, because the next submit repeats it.
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="page auth-page">
        <h1>Check your email</h1>
        <p className="muted">{sent}</p>
        <p className="muted">
          The link works once and expires in an hour. If it does not arrive,
          look in your spam folder.
        </p>
        <nav className="board-nav">
          {/* Already on /signin, so this navigates nowhere -- the onClick is
              what does the work. It used to rely on the full page load to
              clear `sent`; with Link nothing remounts, so clearing it here is
              no longer belt-and-braces, it is the whole mechanism. */}
          <Link to="/signin" onClick={() => setSent(null)}>← Back to sign in</Link>
        </nav>
      </div>
    )
  }

  return (
    <div className="page auth-page">
      <h1>{mode === 'forgot' ? 'Reset your password' : 'Sign in'}</h1>
      <p className="sub">
        {mode === 'forgot'
          ? 'Enter your address and we will send a link to set a new password.'
          : 'The load board is public. Everything else needs an account.'}
      </p>

      {error && <div className="error">{error}</div>}

      <form className="add-form" onSubmit={handleSubmit}>
        <fieldset disabled={busy}>
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </label>

          {mode === 'signin' && (
            <label>
              Password
              {/* autoComplete tells a password manager what this is. Getting
                  it wrong is why managers sometimes refuse to fill a form. */}
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
          )}

          <div className="actions">
            <button type="submit" className="primary">
              {busy ? 'Working...' : mode === 'forgot' ? 'Send the link' : 'Sign in'}
            </button>
            <button
              type="button"
              onClick={() => { setMode(mode === 'forgot' ? 'signin' : 'forgot'); setError(null) }}
            >
              {mode === 'forgot' ? 'Back to sign in' : 'Forgot password?'}
            </button>
          </div>
        </fieldset>
      </form>

      <nav className="board-nav">
        <Link to="/register">Create an account</Link>
        <Link to="/">← The load board</Link>
      </nav>
    </div>
  )
}
