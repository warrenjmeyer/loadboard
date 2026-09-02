import { useState, useEffect, useMemo } from 'react'
import { fetchJson, postJson } from '../lib/api.js'
import AccessNotice from '../components/AccessNotice.jsx'

const ROLES = ['none', 'driver', 'dispatcher', 'admin']

const ROLE_HELP = {
  none: 'Can sign in and see the load board. Nothing else.',
  driver: 'Can see their own settlement, and no one else’s.',
  dispatcher: 'Can add loads and read every settlement.',
  admin: 'Everything, including this page.',
}

// ---------------------------------------------------------------------------
// Approving accounts.
//
// Registration is open and every new account arrives with no role at all, able
// to sign in and do nothing. Before this page the only way to let anyone in was
// an UPDATE at a SQL prompt, which made the whole registration flow a queue
// with no other end.
//
// One row per account, pending ones first, because that is the only row anyone
// opens this page to act on.
// ---------------------------------------------------------------------------
export default function Admin() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [waking, setWaking] = useState(false)
  const [error, setError] = useState(null)
  const [errorStatus, setErrorStatus] = useState(null)

  // Which row is mid-save, and what a row's last failure was. Kept per-row
  // rather than per-page: one refusal should not blank the whole table, and
  // the message belongs beside the control that caused it.
  const [busyId, setBusyId] = useState(null)
  const [rowError, setRowError] = useState({})

  useEffect(() => {
    let cancelled = false
    fetchJson('/api/admin/users', { onWaking: () => !cancelled && setWaking(true) })
      .then((d) => {
        if (cancelled) return
        setData(d)
        setWaking(false)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setErrorStatus(err.status ?? null)
        setWaking(false)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  async function update(publicId, body) {
    setBusyId(publicId)
    setRowError((r) => ({ ...r, [publicId]: null }))

    try {
      const saved = await postJson(`/api/admin/users/${publicId}`, body)

      // Replace the one row rather than refetching the table. A refetch would
      // reorder it -- approving someone moves them out of the pending group --
      // and a row jumping away as you click it is how you click the wrong one.
      setData((d) => ({
        ...d,
        users: d.users.map((u) => (u.publicId === publicId ? saved : u)),
        activeAdmins:
          d.activeAdmins +
          (saved.role === 'admin' && saved.isActive ? 1 : 0) -
          (d.users.find((u) => u.publicId === publicId)?.role === 'admin' &&
          d.users.find((u) => u.publicId === publicId)?.isActive
            ? 1
            : 0),
      }))
    } catch (err) {
      setRowError((r) => ({ ...r, [publicId]: err.message }))
    } finally {
      setBusyId(null)
    }
  }

  const pending = useMemo(
    () => (data?.users || []).filter((u) => u.role === 'none' && u.isActive).length,
    [data]
  )

  if (error && (errorStatus === 401 || errorStatus === 403)) {
    return <AccessNotice error={error} status={errorStatus} />
  }

  if (loading) {
    return (
      <div className="page">
        <header><h1>Accounts</h1></header>
        <p className="muted">
          {waking
            ? 'The database pauses when it is idle. Waking it takes up to a minute.'
            : 'Loading accounts...'}
        </p>
      </div>
    )
  }

  return (
    <div className="page">
      <header>
        <h1>Accounts</h1>
        <p className="sub">
          {data.users.length} account{data.users.length === 1 ? '' : 's'}
          {pending > 0 && ` · ${pending} waiting for approval`}
        </p>
      </header>

      {error && <div className="error">{error}</div>}

      <table className="loads admin-table">
        <thead>
          <tr>
            <th>Account</th>
            <th>Role</th>
            <th>Driver</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.users.map((u) => {
            const isYou = u.email === data.you.email
            const busy = busyId === u.publicId
            // The last admin standing, and you. Both are refused by the
            // server; greying them out here just avoids offering a choice
            // that cannot be taken.
            const lastAdmin = u.role === 'admin' && u.isActive && data.activeAdmins <= 1

            return (
              <tr key={u.publicId} className={u.role === 'none' && u.isActive ? 'row-pending' : undefined}>
                <td>
                  <div className="admin-who">
                    {u.displayName || <span className="muted">no name</span>}
                    {isYou && <span className="badge badge-covered">you</span>}
                  </div>
                  <div className="muted admin-email">{u.email}</div>
                  {!u.emailConfirmed && (
                    <div className="field-error">Email not confirmed</div>
                  )}
                </td>

                <td>
                  <select
                    value={u.role}
                    disabled={busy || isYou || lastAdmin}
                    onChange={(e) => {
                      const role = e.target.value
                      // A driver needs a code, so ask for it in the same
                      // action rather than saving an invalid row and
                      // complaining afterwards.
                      if (role === 'driver') {
                        const code = data.drivers[0]?.code
                        update(u.publicId, { role, driverCode: u.driverCode || code })
                      } else {
                        update(u.publicId, { role })
                      }
                    }}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  <div className="muted hint">{ROLE_HELP[u.role]}</div>
                </td>

                <td>
                  {u.role === 'driver' ? (
                    <select
                      value={u.driverCode || ''}
                      disabled={busy}
                      onChange={(e) => update(u.publicId, { role: 'driver', driverCode: e.target.value })}
                    >
                      {data.drivers.map((d) => (
                        <option key={d.code} value={d.code}>{d.code} — {d.name}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>

                <td>
                  <span className={`badge ${u.isActive ? 'badge-available' : 'badge-delivered'}`}>
                    {u.isActive ? 'active' : 'disabled'}
                  </span>
                  {u.isLockedOut && <div className="field-error">locked out</div>}
                </td>

                <td className="num">
                  <button
                    type="button"
                    disabled={busy || (isYou && u.isActive) || (lastAdmin && u.isActive)}
                    onClick={() => update(u.publicId, { isActive: !u.isActive })}
                  >
                    {busy ? '...' : u.isActive ? 'Disable' : 'Enable'}
                  </button>
                  {rowError[u.publicId] && (
                    <div className="field-error">{rowError[u.publicId]}</div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <p className="muted hint">
        Changes take effect on the account’s next request — roles are read fresh
        every time, so nobody has to sign out and back in. Disabling an account
        ends its sessions immediately.
      </p>

      <nav className="board-nav">
        <a href="/">← The load board</a>
        <a href="?view=settlements">Driver settlements</a>
      </nav>
    </div>
  )
}
