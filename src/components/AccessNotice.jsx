// ---------------------------------------------------------------------------
// What a page shows when the API refused it.
//
// 401 and 403 are different answers and deserve different pages. 401 means we
// do not know who you are, and signing in fixes it. 403 means we do, and it
// never will -- offering a sign-in link there sends someone round a loop that
// cannot end, which is worse than saying no.
//
// Anything else is a genuine failure and keeps the old wording, because "could
// not load data" is honest about a database that fell over and would be a lie
// about a permission check that worked exactly as designed.
// ---------------------------------------------------------------------------
import { Link } from 'react-router-dom'

export default function AccessNotice({ error, status }) {
  if (status === 401) {
    return (
      <div className="page auth-page">
        <h1>Sign in to continue</h1>
        <p className="muted">{error}</p>
        <nav className="board-nav">
          <Link to="/signin">Sign in</Link>
          <Link to="/register">Create an account</Link>
          <Link to="/">← The load board</Link>
        </nav>
      </div>
    )
  }

  if (status === 403) {
    return (
      <div className="page auth-page">
        <h1>Not available to your account</h1>
        <p className="muted">{error}</p>
        <nav className="board-nav">
          <Link to="/">← The load board</Link>
        </nav>
      </div>
    )
  }

  return <div className="error">Could not load data: {error}</div>
}
