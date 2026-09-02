import { fetchJson, postJson } from './api.js'

// ---------------------------------------------------------------------------
// The browser half of the login.
//
// Every one of these is a thin call to a route that does the real work. That
// is the point: nothing here decides anything. The session lives in an
// HttpOnly cookie the browser cannot read, so this module has no way to know
// who is signed in except by asking the server, and no way to fake it.
//
// This replaces the old fetchUser(), which asked Static Web Apps' /.auth/me.
// That endpoint answers "did you sign in with GitHub", which turned out to be
// a different question from "do you have an account here".
// ---------------------------------------------------------------------------

// Returns the signed-in user, or null. Never throws for "nobody is signed in"
// -- that is an answer, and /api/me returns it as a 200 with a null body,
// because a page that shows a sign-in link needs to render either way.
export async function fetchMe(options) {
  const body = await fetchJson('/api/me', options)
  return body?.user ?? null
}

export async function login(email, password) {
  return postJson('/api/login', { email, password })
}

export async function logout() {
  return postJson('/api/logout', {})
}

// Registration answers 202 with the same message whether the address was new,
// already taken, or malformed -- so there is deliberately nothing here to
// branch on. Anything else would put the account-enumeration oracle back in
// the browser after the server went to the trouble of removing it.
export async function register({ email, password, displayName }) {
  return postJson('/api/register', { email, password, displayName })
}

export async function verifyEmail(token) {
  return postJson('/api/verify', { token })
}

export async function requestReset(email) {
  return postJson('/api/forgot', { email })
}

export async function resetPassword(token, password) {
  return postJson('/api/reset', { token, password })
}

// ---------------------------------------------------------------------------
// Reading the one-time links out of the URL.
//
// The token is removed from the address bar as soon as it has been read.
// Otherwise it survives in browser history, in a screenshot, in whatever the
// person pastes into a chat window when asking why the page looks odd -- and
// although the token is single-use and expires in an hour, none of those are
// places a credential should ever sit.
// ---------------------------------------------------------------------------
export function takeTokenFromUrl(param) {
  const params = new URLSearchParams(window.location.search)
  const token = params.get(param)
  if (!token) return null

  params.delete(param)
  const rest = params.toString()
  window.history.replaceState(
    {},
    '',
    window.location.pathname + (rest ? `?${rest}` : '')
  )

  return token
}
