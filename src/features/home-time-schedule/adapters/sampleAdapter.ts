import fixture from '../fixtures/schedule.json'
import { applyAction, checkNewStay } from '../rules.ts'
import type { ScheduleAdapter, ScheduleData, Stay } from '../contract.ts'

// ---------------------------------------------------------------------------
// The sample schedule, kept in memory for as long as the page is open, so
// approving, declining and requesting actually change it -- and a reload
// puts it back. It runs every move through rules.ts exactly as a real server
// should: a refused move is refused here too, in the same words.
//
// The clock is the sample's own (asOf), so every stamp -- decidedAt,
// arrivedAt -- lands on the same Monday morning as the rest of the data.
//
// Does not port. The host's adapter talks to its API instead; this is the
// template for what that adapter promises.
// ---------------------------------------------------------------------------
const SAMPLE = fixture as ScheduleData
const NOW = SAMPLE.asOf || new Date().toISOString()
const DELAY_MS = 250

let stays: Stay[] = structuredClone(SAMPLE.stays)
let nextId = 2001

function pause(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, DELAY_MS)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Cancelled.', 'AbortError'))
    })
  })
}

export const sampleScheduleAdapter: ScheduleAdapter = {
  async loadSchedule({ signal }) {
    await pause(signal)
    return { asOf: NOW, drivers: structuredClone(SAMPLE.drivers), stays: structuredClone(stays) }
  },

  async requestStay(request) {
    await pause()
    const problems = checkNewStay(request, stays, { now: NOW })
    if (problems.length > 0) throw new Error(problems.join(' '))
    const stay: Stay = {
      id: `HT-${nextId++}`,
      driverCode: request.driverCode,
      homeBy: request.homeBy,
      backOut: request.backOut,
      status: 'REQUESTED',
      note: request.note,
      requestedAt: NOW,
      decidedAt: null, decidedBy: null, declineReason: null, arrivedAt: null, leftAt: null,
    }
    stays = [...stays, stay]
    return structuredClone(stay)
  },

  async actOnStay(id, action) {
    await pause()
    const stay = stays.find((s) => s.id === id)
    if (!stay) throw new Error('That stay no longer exists.')
    const result = applyAction(stay, action, { now: NOW, by: 'Dispatch (preview)' })
    if ('error' in result) throw new Error(result.error)
    stays = stays.map((s) => (s.id === id ? result.stay : s))
    return structuredClone(result.stay)
  },
}

/** The stays as they stand -- for the preview, which feeds them to the planner. */
export function sampleStays(): readonly Stay[] {
  return stays
}
