import { useState, useEffect, useRef } from 'react'
import { verifyEmail } from '../lib/auth.js'

// ---------------------------------------------------------------------------
// Where the emailed confirmation link lands.
//
// This one acts on arrival rather than showing a button, because there is
// nothing to decide -- the person already decided by clicking the link.
//
// Confirming an address is not the same as being approved, and the page says
// so plainly. Otherwise the obvious reading of "your email is confirmed" is
// "you are in", and the next click into an empty board looks like a bug
// rather than a queue.
// ---------------------------------------------------------------------------
export default function VerifyEmail({ token }) {
  const [state, setState] = useState('working') // working | done | failed
  const [message, setMessage] = useState('')

  // StrictMode runs every effect twice in development to surface impure code.
  // Usually that is harmless. Here it is not: the token is single-use, so the
  // second run would spend a link the first run already spent and report a
  // perfectly good link as broken -- in dev only, which is the worst kind of
  // bug to chase.
  //
  // A ref survives re-renders and is not state, so setting it triggers
  // nothing. This is the standard guard for an effect that must fire exactly
  // once because it has a side effect somebody else can see.
  const spent = useRef(false)

  useEffect(() => {
    if (spent.current) return
    spent.current = true

    let cancelled = false

    verifyEmail(token)
      .then((result) => {
        if (cancelled) return
        setMessage(result.message)
        setState('done')
      })
      .catch((err) => {
        if (cancelled) return
        setMessage(err.message)
        setState('failed')
      })

    return () => { cancelled = true }
    // The token never changes for the life of this component -- it was read
    // once out of the URL -- so this runs exactly once.
  }, [token])

  return (
    <div className="page auth-page">
      <h1>
        {state === 'working' ? 'Confirming your email...' : state === 'done' ? 'Email confirmed' : 'That link did not work'}
      </h1>

      {state === 'working' && (
        <p className="muted">
          One moment. The database pauses when idle, so this can take up to a
          minute on the first visit after a quiet spell.
        </p>
      )}

      {state === 'done' && <p className="muted">{message}</p>}

      {state === 'failed' && (
        <>
          <div className="error">{message}</div>
          <p className="muted">
            Links work once and expire after an hour. If yours has been used or
            has aged out, sign in and ask for a new one.
          </p>
        </>
      )}

      {state !== 'working' && (
        <nav className="board-nav">
    {/* This page renders OUTSIDE the router (see main.jsx: it is reached from
        an email, with a credential that must be scrubbed before the router
        mounts). So <Link> would throw "useHref() may be used only in the
        context of a <Router>" here -- these stay plain <a> elements, and a
        full page load into the app is the right thing after a token is spent. */}
          <a href="/signin">Sign in</a>
          <a href="/">← The load board</a>
        </nav>
      )}
    </div>
  )
}
