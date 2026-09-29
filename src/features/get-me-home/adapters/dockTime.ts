// ---------------------------------------------------------------------------
// A dock's wall-clock time, given the zone it is in.
//
// The load board stores delivery windows as naive local time --
// "2026-09-28T16:00:00", no zone -- because a dock window is local to the dock
// and always has been (api/src/etaRules.js explains why converting them to
// UTC "to be safe" puts a Denver delivery an hour wrong). The planner's
// contract wants a moment WITH a zone. The only thing that knows which zone
// is the place, and the place is "JOLIET, IL": so the state picks the zone.
//
// This belongs to the load board's adapter, not to the planner. The host has
// its own data and its own way of storing a time; this file does not port.
// ---------------------------------------------------------------------------

// Each state to the IANA zone most of it keeps. Fourteen states are split,
// and for those this is the zone the bigger freight cities are in -- so a
// dock in El Paso, Knoxville or the Florida panhandle can be an hour out.
// The lanes this fleet runs (Iowa, Illinois, the Southwest) are all in
// single-zone states, and the map below says which ones are not.
export const STATE_ZONES: Readonly<Record<string, string>> = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago',
  CA: 'America/Los_Angeles', CO: 'America/Denver', CT: 'America/New_York', DE: 'America/New_York',
  DC: 'America/New_York', FL: 'America/New_York' /* split */, GA: 'America/New_York', HI: 'Pacific/Honolulu',
  ID: 'America/Boise' /* split */, IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis' /* split */,
  IA: 'America/Chicago', KS: 'America/Chicago' /* split */, KY: 'America/New_York' /* split */,
  LA: 'America/Chicago', ME: 'America/New_York', MD: 'America/New_York', MA: 'America/New_York',
  MI: 'America/Detroit' /* split */, MN: 'America/Chicago', MS: 'America/Chicago', MO: 'America/Chicago',
  MT: 'America/Denver', NE: 'America/Chicago' /* split */, NV: 'America/Los_Angeles' /* split */,
  NH: 'America/New_York', NJ: 'America/New_York', NM: 'America/Denver', NY: 'America/New_York',
  NC: 'America/New_York', ND: 'America/Chicago' /* split */, OH: 'America/New_York', OK: 'America/Chicago',
  OR: 'America/Los_Angeles' /* split */, PA: 'America/New_York', RI: 'America/New_York', SC: 'America/New_York',
  SD: 'America/Chicago' /* split */, TN: 'America/Chicago' /* split */, TX: 'America/Chicago' /* split */,
  UT: 'America/Denver', VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles',
  WV: 'America/New_York', WI: 'America/Chicago', WY: 'America/Denver',
}

// "JOLIET, IL" -> "IL"; null when the place does not end in a state.
export function stateOf(place: string | null | undefined): string | null {
  if (!place) return null
  const tail = place.split(',').pop()?.trim().toUpperCase() || ''
  return /^[A-Z]{2}$/.test(tail) ? tail : null
}

// The zone's offset from UTC at one instant, in minutes: what a clock in that
// zone reads, minus what UTC reads.
function offsetMinutes(timeZone: string, instantMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instantMs)
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'))
  return Math.round((wall - instantMs) / 60000)
}

// "2026-09-28T16:00:00" at a dock in America/Chicago -> "2026-09-28T16:00:00-05:00".
//
// The wall clock is kept exactly as written and the zone's offset for that
// date is appended, so what a dispatcher sees in the load and what the
// planner reads are the same sixteen hundred hours. Two passes because the
// offset depends on the instant, and the instant depends on the offset: the
// first guess is right except within an hour of a daylight-saving change,
// which the second pass corrects. Null for anything that is not a date-time
// or a zone this runtime does not know.
export function zonedFromWallClock(wallClock: string | null | undefined, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(wallClock || '')
  if (!m) return null
  const [, y, mo, d, h, mi, s = '00'] = m
  const asIfUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
  try {
    let offset = offsetMinutes(timeZone, asIfUtc)
    offset = offsetMinutes(timeZone, asIfUtc - offset * 60000)
    const sign = offset < 0 ? '-' : '+'
    const abs = Math.abs(offset)
    const hh = String(Math.floor(abs / 60)).padStart(2, '0')
    const mm = String(abs % 60).padStart(2, '0')
    return `${y}-${mo}-${d}T${h}:${mi}:${s}${sign}${hh}:${mm}`
  } catch {
    return null // RangeError: a zone name this runtime has never heard of
  }
}
