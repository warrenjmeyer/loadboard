// ---------------------------------------------------------------------------
// Sending mail through SendGrid.
//
// Their v3 send API is one JSON POST, so this talks to it with fetch rather
// than pulling in @sendgrid/mail. The SDK would add a dependency tree to the
// Function App to save about fifteen lines, and this app has spent the whole
// build avoiding exactly that trade.
//
// Configuration, all from the Function App's settings:
//
//   SENDGRID_API_KEY   a Restricted Access key with Mail Send and nothing else
//   MAIL_FROM          the verified single sender
//   MAIL_FROM_NAME     display name, optional
//   MAIL_REPLY_TO      where replies go, optional but see below
//   PUBLIC_BASE_URL    origin for the links in the mail, optional
// ---------------------------------------------------------------------------

const SEND_URL = 'https://api.sendgrid.com/v3/mail/send'

// Ten seconds. Sending happens while someone waits on a form submit, and a
// hung mail provider must not hold a Function open until the platform kills it.
const TIMEOUT_MS = 10000

function config() {
  return {
    apiKey: process.env.SENDGRID_API_KEY || '',
    from: process.env.MAIL_FROM || '',
    fromName: process.env.MAIL_FROM_NAME || 'Load Board',
    // Replies default to the sender if nothing else is set. Worth setting to a
    // mailbox someone reads: the most valuable reply a password-reset mail can
    // get is "I did not request this", which is somebody reporting an account
    // takeover in progress. A noreply address throws that away.
    replyTo: process.env.MAIL_REPLY_TO || '',
    baseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  }
}

function isConfigured() {
  const c = config()
  return Boolean(c.apiKey && c.from)
}

// The origin to build links against. Prefers the configured value, falls back
// to what the request arrived on -- so a PR preview environment builds links
// back to itself rather than to production.
function baseUrlFor(request) {
  const configured = config().baseUrl
  if (configured) return configured

  const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host')
  if (forwardedHost) {
    const proto = request.headers.get('x-forwarded-proto') || 'https'
    return `${proto}://${forwardedHost}`
  }
  return ''
}

// Returns { sent: boolean, reason?: string }. Never throws: a route's job is
// to decide what the caller is told, and that decision must not be made by an
// exception escaping from here.
async function sendMail({ to, subject, text, html }) {
  const c = config()

  if (!c.apiKey || !c.from) {
    return { sent: false, reason: 'not-configured' }
  }

  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: c.from, name: c.fromName },
    subject,
    content: [
      // Order matters to the RFC: alternatives run least-preferred first, so
      // plain text comes before HTML. Both are always sent -- a text part is
      // what makes the mail readable in a client that refuses HTML, and its
      // absence is itself a spam signal.
      { type: 'text/plain', value: text },
      ...(html ? [{ type: 'text/html', value: html }] : []),
    ],
    ...(c.replyTo ? { reply_to: { email: c.replyTo } } : {}),
    // Transactional mail must never carry the marketing unsubscribe machinery
    // or land in a suppression list -- a password reset that silently vanishes
    // because someone once unsubscribed is an account nobody can recover.
    mail_settings: { bypass_list_management: { enable: true } },
    tracking_settings: {
      // No open pixel, no rewritten links. Rewriting a reset URL through a
      // click tracker makes it look like a phishing redirect and breaks the
      // one thing the mail exists to deliver.
      click_tracking: { enable: false, enable_text: false },
      open_tracking: { enable: false },
    },
  }

  try {
    const res = await fetch(SEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (res.status === 202) return { sent: true }

    // SendGrid explains refusals in the body -- an unverified sender, a
    // malformed address, a key without Mail Send. Worth capturing for the log,
    // never worth showing a caller.
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 500)
    } catch {
      // A refusal we cannot read is still a refusal.
    }
    return { sent: false, reason: `http-${res.status}`, detail }
  } catch (err) {
    return { sent: false, reason: 'network', detail: err.message }
  }
}

// ---------------------------------------------------------------------------
// The two messages this app sends.
//
// Both are deliberately plain. A password link arriving as a wall of images
// and buttons from an unfamiliar domain looks exactly like phishing, and we
// are asking someone to click a long opaque URL -- the least we can do is make
// the mail look like a person wrote it.
//
// Neither ever contains a password. The 2023 ColdFusion original emailed a
// temporary one, and that password then lived in an inbox forever.
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch])
}

function linkMail({ heading, lead, url, expiryMinutes, ignoreLine }) {
  const text = [
    lead,
    '',
    url,
    '',
    `The link works once and expires in ${expiryMinutes} minutes.`,
    ignoreLine,
  ].join('\n')

  const html = `<!doctype html>
<html><body style="font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.5; color: #1c1e21;">
  <p style="font-size:17px;font-weight:600;margin:0 0 12px;">${escapeHtml(heading)}</p>
  <p style="margin:0 0 16px;">${escapeHtml(lead)}</p>
  <p style="margin:0 0 16px;"><a href="${escapeHtml(url)}" style="color:#1a4fd8;">${escapeHtml(url)}</a></p>
  <p style="margin:0 0 16px;color:#5b636d;">The link works once and expires in ${expiryMinutes} minutes.</p>
  <p style="margin:0;color:#5b636d;">${escapeHtml(ignoreLine)}</p>
</body></html>`

  return { text, html }
}

function verificationMail(url, expiryMinutes) {
  return {
    subject: 'Confirm your Load Board account',
    ...linkMail({
      heading: 'Confirm your email address',
      lead: 'Someone created a Load Board account with this address. Open the link below to confirm it.',
      url,
      expiryMinutes,
      ignoreLine: 'If that was not you, ignore this message and no account will be usable.',
    }),
  }
}

function resetMail(url, expiryMinutes) {
  return {
    subject: 'Reset your Load Board password',
    ...linkMail({
      heading: 'Reset your password',
      lead: 'Someone asked to reset the Load Board password for this address. Open the link below to choose a new one.',
      url,
      expiryMinutes,
      // The line that turns a wasted email into a security report. Nothing has
      // changed on the account at this point -- asking for a reset does not
      // touch the existing password, which is precisely the hole the 2023
      // ColdFusion version had.
      ignoreLine: 'If that was not you, your password has not changed and you can ignore this. If it keeps happening, reply and tell us.',
    }),
  }
}

// Sent when someone tries to register an address that already has an account.
// They get told; the person filling in the form does not, because a form that
// says "that address is taken" is an account-enumeration oracle.
function alreadyRegisteredMail(signInUrl) {
  const text = [
    'Someone tried to create a Load Board account with this address, but one already exists.',
    '',
    `If that was you, sign in instead: ${signInUrl}`,
    '',
    'If you have forgotten your password, use the "forgot password" link on that page.',
    '',
    'If it was not you, nothing has changed and there is nothing you need to do.',
  ].join('\n')

  return {
    subject: 'You already have a Load Board account',
    text,
    html: `<!doctype html>
<html><body style="font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.5; color: #1c1e21;">
  <p style="font-size:17px;font-weight:600;margin:0 0 12px;">You already have an account</p>
  <p style="margin:0 0 16px;">Someone tried to create a Load Board account with this address, but one already exists.</p>
  <p style="margin:0 0 16px;">If that was you, <a href="${escapeHtml(signInUrl)}" style="color:#1a4fd8;">sign in instead</a>. Forgotten the password? Use the "forgot password" link on that page.</p>
  <p style="margin:0;color:#5b636d;">If it was not you, nothing has changed and there is nothing you need to do.</p>
</body></html>`,
  }
}

module.exports = {
  sendMail,
  isConfigured,
  baseUrlFor,
  verificationMail,
  resetMail,
  alreadyRegisteredMail,
}
