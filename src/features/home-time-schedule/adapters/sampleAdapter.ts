import fixture from '../fixtures/schedule.json'
import { applyAction, checkNewStay } from '../rules.ts'
import { scopeBoard, scopeDriver, scopeQueue, scopeStay } from '../scope.ts'
import type { ScheduleAdapter, ScheduleData, Stay } from '../contract.ts'

// ---------------------------------------------------------------------------
// The sample schedule, kept in memory for as long as the page is open, so
// approving, declining and requesting actually change it -- and a reload
// puts it back.
//
// It behaves the way the real server must:
//   - each read answers with its SCOPE and no more (scope.ts), so a module
//     that quietly depends on data it did not ask for breaks here first;
//   - every move runs through rules.ts, so a refused move is refused here
//     too, in the same words.
//
// The clock is the sample's own (asOf), so every stamp lands on the same
// Monday morning as the rest of the data.
//
// Does not port. The host's adapter talks to its API instead; this is the
// template for what that adapter promises.
// ---------------------------------------------------------------------------
const SAMPLE = fixture as ScheduleData
export const SAMPLE_NOW = SAMPLE.asOf || new Date().toISOString()
const DELAY_MS = 250

let stays: Stay[] = structuredClone(SAMPLE.stays)
let nextId = 2001

// Refuses a signal that is already cancelled, as fetch and axios do -- an
// 'abort' listener added after the fact never fires.
function pause(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Cancelled.', 'AbortError'))
    const timer = setTimeout(resolve, DELAY_MS)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Cancelled.', 'AbortError'))
    })
  })
}

// Everything the store holds, as of now -- the input to every scope.
const everything = (): ScheduleData => ({ asOf: SAMPLE_NOW, drivers: SAMPLE.drivers, stays })

export const sampleScheduleAdapter: ScheduleAdapter = {
  async loadQueue({ signal }) {
    await pause(signal)
    return structuredClone(scopeQueue(everything()))
  },

  async loadBoard({ from, to, signal }) {
    await pause(signal)
    return structuredClone(scopeBoard(everything(), { from, to }))
  },

  async loadDriverStays({ driverCode, signal }) {
    await pause(signal)
    return structuredClone(scopeDriver(everything(), driverCode))
  },

  async loadStay({ id, signal }) {
    await pause(signal)
    return structuredClone(scopeStay(everything(), id))
  },

  async requestStay(request) {
    await pause()
    const problems = checkNewStay(request, stays, { now: SAMPLE_NOW })
    if (problems.length > 0) throw new Error(problems.join(' '))
    const stay: Stay = {
      id: `HT-${nextId++}`,
      driverCode: request.driverCode,
      homeBy: request.homeBy,
      backOut: request.backOut,
      status: 'REQUESTED',
      note: request.note,
      requestedAt: SAMPLE_NOW,
      decidedAt: null, decidedBy: null, declineReason: null, arrivedAt: null, leftAt: null,
    }
    stays = [...stays, stay]
    return structuredClone(stay)
  },

  async actOnStay(id, action) {
    await pause()
    const stay = stays.find((s) => s.id === id)
    if (!stay) throw new Error('That stay no longer exists.')
    const result = applyAction(stay, action, { now: SAMPLE_NOW, by: 'Dispatch (preview)' })
    if ('error' in result) throw new Error(result.error)
    stays = stays.map((s) => (s.id === id ? result.stay : s))
    return structuredClone(result.stay)
  },
}

/** The stays as they stand -- for the preview, which feeds them to the planner. */
export function sampleStays(): readonly Stay[] {
  return stays
}
