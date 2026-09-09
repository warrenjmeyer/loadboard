// ---------------------------------------------------------------------------
// Editing a load's itinerary: add a stop, remove one, move one up or down,
// and fill in the dock. Controlled, like the other forms: `stops` is the
// draft, onChange(nextStops) reports every edit up, and the page owns
// saving it with PUT /api/loads/{id}/stops.
//
// Departed stops are locked in place -- the server refuses to move or drop
// them, so the buttons for that are absent rather than present-and-refused
// -- but their fields stay editable, because a corrected phone number is a
// fine thing to fix after the fact.
//
// Helpers for the draft shape live here with the editor, the way the fleet
// forms keep theirs, so a page never assembles a stop by hand.
// ---------------------------------------------------------------------------
export const BLANK_STOP = {
  stopId: null, stopType: 'Delivery', place: '', name: '', address: '', phone: '',
  windowStart: '', windowEnd: '', referenceNo: '', notes: '', departedUtc: null, arrivedUtc: null,
}

// API stop -> draft (nulls become '' so inputs stay controlled).
export function stopToDraft(s) {
  const d = { ...BLANK_STOP }
  for (const k of Object.keys(BLANK_STOP)) {
    if (s[k] !== undefined && s[k] !== null) d[k] = k === 'windowStart' || k === 'windowEnd' ? String(s[k]).slice(0, 16) : s[k]
  }
  return d
}

// Draft -> what PUT accepts ('' back to null; check-in times are not sent,
// the server keeps its own).
export function draftToBody(stops) {
  return stops.map((s) => ({
    stopId: s.stopId || undefined,
    stopType: s.stopType,
    place: s.place.trim() || null,
    name: s.name.trim() || null,
    address: s.address.trim() || null,
    phone: s.phone.trim() || null,
    windowStart: s.windowStart || null,
    windowEnd: s.windowEnd || null,
    referenceNo: s.referenceNo.trim() || null,
    notes: s.notes.trim() || null,
  }))
}

export default function StopEditor({ stops, onChange }) {
  const set = (i, name, value) => onChange(stops.map((s, j) => (j === i ? { ...s, [name]: value } : s)))
  const remove = (i) => onChange(stops.filter((_, j) => j !== i))
  const move = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= stops.length) return
    const next = [...stops]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  // A new stop goes in before the last delivery, typed Delivery, which is
  // the common case: one more drop on the way to the final one.
  const add = () => {
    const next = [...stops]
    next.splice(Math.max(1, stops.length - 1), 0, { ...BLANK_STOP })
    onChange(next)
  }

  const lockedThrough = stops.reduce((n, s, i) => (s.departedUtc ? i + 1 : n), 0)

  return (
    <div className="stop-editor">
      {stops.map((s, i) => {
        const locked = Boolean(s.departedUtc)
        const canMoveUp = !locked && i > lockedThrough && i > 0
        const canMoveDown = !locked && i >= lockedThrough && i < stops.length - 1
        return (
          <fieldset key={s.stopId ?? `new-${i}`} className={`stop-edit${locked ? ' stop-edit-locked' : ''}`}>
            <legend>
              <span className="mono">Stop {i + 1}</span>
              {locked && <span className="muted small"> · departed, fixed in order</span>}
            </legend>
            <div className="dispatch-row">
              <label>
                Type
                <select value={s.stopType} onChange={(e) => set(i, 'stopType', e.target.value)}>
                  <option>Pickup</option>
                  <option>Delivery</option>
                </select>
              </label>
              <label>
                City, state
                <input type="text" maxLength={100} value={s.place} onChange={(e) => set(i, 'place', e.target.value)} placeholder="Rockford, IL" required />
              </label>
              <label>
                Reference #
                <input type="text" maxLength={40} value={s.referenceNo} onChange={(e) => set(i, 'referenceNo', e.target.value)} />
              </label>
            </div>
            <div className="dispatch-row">
              <label>
                {s.stopType === 'Pickup' ? 'Shipper' : 'Consignee'}
                <input type="text" maxLength={100} value={s.name} onChange={(e) => set(i, 'name', e.target.value)} />
              </label>
              <label>
                Address
                <input type="text" maxLength={200} value={s.address} onChange={(e) => set(i, 'address', e.target.value)} />
              </label>
              <label>
                Phone
                <input type="tel" maxLength={30} value={s.phone} onChange={(e) => set(i, 'phone', e.target.value)} />
              </label>
            </div>
            <div className="dispatch-row">
              <label>
                Window start
                <input type="datetime-local" value={s.windowStart} onChange={(e) => set(i, 'windowStart', e.target.value)} />
              </label>
              <label>
                Window end
                <input type="datetime-local" value={s.windowEnd} onChange={(e) => set(i, 'windowEnd', e.target.value)} />
              </label>
              <label>
                Notes
                <input type="text" maxLength={400} value={s.notes} onChange={(e) => set(i, 'notes', e.target.value)} placeholder="dock 14, call ahead" />
              </label>
            </div>
            <div className="actions stop-edit-actions">
              {canMoveUp && <button type="button" className="linklike" onClick={() => move(i, -1)}>↑ Up</button>}
              {canMoveDown && <button type="button" className="linklike" onClick={() => move(i, 1)}>↓ Down</button>}
              {!locked && stops.length > 2 && <button type="button" className="linklike" onClick={() => remove(i)}>Remove</button>}
            </div>
          </fieldset>
        )
      })}
      <p><button type="button" onClick={add}>+ Add a stop</button></p>
    </div>
  )
}
